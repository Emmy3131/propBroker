const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const MarketInstrument = require("../models/MarketInstrumentModel");
const TradingPosition = require("../models/TradingPositionModel");
const TradingAccount = require("../models/TradingAccountModel");
const tradingRiskService = require("./tradingRiskService");
const positionLiquidationService = require("./positionLiquidationServices");
const positionManagementService = require("./positionManagementService");

const decimal = (value, label) => {
  if (value === undefined || value === null) {
    throw new Error(`${label} is missing.`);
  }

  let result;

  try {
    result = new Decimal(value.toString());
  } catch {
    throw new Error(`${label} is invalid.`);
  }

  if (!result.isFinite()) {
    throw new Error(`${label} is invalid.`);
  }

  return result;
};

const decimal128 = (value) =>
  mongoose.Types.Decimal128.fromString(
    value.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8),
  );

const calculatePositionPnl = (position, price) => {
  const entryPrice = decimal(position.entryPrice, "Entry price");
  const quantity = decimal(position.quantity, "Quantity");
  const contractSize = decimal(position.contractSize, "Contract size");

  let pnl = price.minus(entryPrice).times(quantity).times(contractSize);

  if (position.side === "sell") {
    pnl = pnl.negated();
  }

  return pnl;
};

// Determine whether a position has reached a stop-loss or take-profit.
// If a price jump crosses both levels, prioritize the stop-loss.
const getTriggeredExit = (position, price) => {
  const stopLoss =
    position.stopLoss == null ? null : decimal(position.stopLoss, "Stop-loss");

  const takeProfit =
    position.takeProfit == null
      ? null
      : decimal(position.takeProfit, "Take-profit");

  if (position.side === "buy") {
    if (stopLoss && price.lte(stopLoss)) {
      return "stop_loss";
    }

    if (takeProfit && price.gte(takeProfit)) {
      return "take_profit";
    }
  } else if (position.side === "sell") {
    if (stopLoss && price.gte(stopLoss)) {
      return "stop_loss";
    }

    if (takeProfit && price.lte(takeProfit)) {
      return "take_profit";
    }
  }

  return null;
};

exports.updateSimulatedPrice = async ({ symbol, price }) => {
  const normalizedSymbol = String(symbol || "")
    .trim()
    .toUpperCase();

  if (!normalizedSymbol) {
    throw new Error("Instrument symbol is required.");
  }

  const newPrice = decimal(price, "Price");

  if (!newPrice.isPositive()) {
    throw new Error("Price must be greater than zero.");
  }

  const session = await mongoose.startSession();

  let instrumentId;
  let updatedPositions = 0;
  let affectedAccountIds = [];
  let triggeredPositions = [];
  let priceUpdatedAt;

  try {
    // Transaction 1: persist the price and mark positions to market.
    await session.withTransaction(async () => {
      const instrument = await MarketInstrument.findOne({
        symbol: normalizedSymbol,
        isActive: true,
      }).session(session);

      if (!instrument) {
        throw new Error("Active instrument not found.");
      }

      if (
        instrument.priceSource !== "simulated" ||
        instrument.quoteCurrency !== "USD"
      ) {
        throw new Error(
          "Only USD-quoted simulated instruments can be updated.",
        );
      }

      instrument.currentPrice = decimal128(newPrice);
      instrument.priceUpdatedAt = new Date();

      await instrument.save({ session });

      instrumentId = instrument._id;
      priceUpdatedAt = instrument.priceUpdatedAt;

      const positions = await TradingPosition.find({
        instrument: instrument._id,
        status: "open",
      }).session(session);

      const accounts = new Set();
      const triggered = [];

      for (const position of positions) {
        const pnl = calculatePositionPnl(position, newPrice);

        position.currentPrice = decimal128(newPrice);
        position.unrealizedPnl = decimal128(pnl);

        await position.save({ session });

        accounts.add(position.tradingAccount.toString());

        const exitReason = getTriggeredExit(position, newPrice);

        if (exitReason) {
          triggered.push({
            positionId: position._id.toString(),
            userId: position.user.toString(),
            reason: exitReason,
          });
        }
      }

      updatedPositions = positions.length;
      affectedAccountIds = [...accounts];
      triggeredPositions = triggered;
    });
  } finally {
    await session.endSession();
  }

  // Close triggered positions through the existing position-management
  // service so realized P&L and margin are settled consistently.
  const automaticClosures = [];
  const closureFailures = [];

  for (const triggered of triggeredPositions) {
    try {
      const closeResult = await positionManagementService.closePosition({
        userId: triggered.userId,
        positionId: triggered.positionId,
      });

      automaticClosures.push({
        positionId: triggered.positionId,
        reason: triggered.reason,
        realizedPnl: closeResult.realizedPnl,
        status: "closed",
      });
    } catch (error) {
      // A manual close or risk liquidation may have won the race.
      let currentPosition;

      try {
        currentPosition = await TradingPosition.findById(
          triggered.positionId,
        ).select("status");
      } catch (lookupError) {
        console.error(
          "Unable to verify triggered position:",
          triggered.positionId,
          lookupError,
        );
      }

      if (currentPosition?.status === "closed") {
        automaticClosures.push({
          positionId: triggered.positionId,
          reason: triggered.reason,
          status: "already_closed",
        });

        continue;
      }

      closureFailures.push({
        positionId: triggered.positionId,
        reason: triggered.reason,
        status: currentPosition ? currentPosition.status : "unknown",
        message: error.message,
      });

      console.error(
        "Automatic SL/TP closure failed:",
        triggered.positionId,
        error,
      );
    }
  }

  // Recalculate affected accounts using their remaining open positions.
  // This also evaluates risk when no stop-loss or take-profit was triggered.
  const riskSession = await mongoose.startSession();

  try {
    await riskSession.withTransaction(async () => {
      for (const accountId of affectedAccountIds) {
        const account =
          await TradingAccount.findById(accountId).session(riskSession);

        if (!account) {
          continue;
        }

        const openPositions = await TradingPosition.find({
          tradingAccount: account._id,
          status: "open",
        }).session(riskSession);

        let totalUnrealizedPnl = new Decimal(0);
        let totalUsedMargin = new Decimal(0);

        for (const position of openPositions) {
          totalUnrealizedPnl = totalUnrealizedPnl.plus(
            decimal(position.unrealizedPnl, "Position unrealized P&L"),
          );

          totalUsedMargin = totalUsedMargin.plus(
            decimal(position.marginUsed, "Position margin"),
          );
        }

        const balance = decimal(account.balance, "Account balance");
        const rawEquity = balance.plus(totalUnrealizedPnl);
        const equity = Decimal.max(0, rawEquity);
        const freeMargin = Decimal.max(0, equity.minus(totalUsedMargin));

        account.unrealizedPnl = decimal128(totalUnrealizedPnl);
        account.usedMargin = decimal128(totalUsedMargin);
        account.equity = decimal128(equity);
        account.freeMargin = decimal128(freeMargin);

        const highestEquity = decimal(account.highestEquity, "Highest equity");

        if (equity.gt(highestEquity)) {
          account.highestEquity = decimal128(equity);
        }

        if (
          rawEquity.lte(0) &&
          !["breached", "completed", "closed"].includes(account.status)
        ) {
          account.status = "breached";
          account.breachedAt = new Date();
        }

        const riskResult = await tradingRiskService.evaluateAccountRisk(
          account,
          riskSession,
        );

        if (riskResult.account.status === "breached") {
          await positionLiquidationService.liquidateAccountPositions({
            accountId: account._id,
            session: riskSession,
          });
        }
      }
    });
  } finally {
    await riskSession.endSession();
  }

  return {
    symbol: normalizedSymbol,
    price: newPrice.toFixed(8),
    updatedPositions,
    updatedAccounts: affectedAccountIds.length,
    automaticClosures,
    closureFailures,
    priceUpdatedAt,
  };
};
