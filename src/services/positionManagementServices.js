const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const TradingAccount = require("../models/TradingAccountModel");
const TradingPosition = require("../models/TradingPositionModel");
const MarketInstrument = require("../models/MarketInstrumentModel");
const tradingRiskService = require("./tradingRiskService");
const positionLiquidationService = require("./positionLiquidationServices");

const toDecimal = (value, fieldName) => {
  if (value === undefined || value === null) {
    throw new Error(`${fieldName} is missing.`);
  }

  let result;

  try {
    result = new Decimal(value.toString());
  } catch {
    throw new Error(`${fieldName} is invalid.`);
  }

  if (!result.isFinite()) {
    throw new Error(`${fieldName} is invalid.`);
  }

  return result;
};

const toDecimal128 = (value) =>
  mongoose.Types.Decimal128.fromString(
    value.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8),
  );

exports.closePosition = async ({ userId, positionId }) => {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid user ID.");
  }

  if (!mongoose.isValidObjectId(positionId)) {
    throw new Error("Invalid position ID.");
  }

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const position = await TradingPosition.findOne({
        _id: positionId,
        user: userId,
        status: "open",
      }).session(session);

      if (!position) {
        throw new Error(
          "Open position not found, or you do not have permission to close it.",
        );
      }

      const account = await TradingAccount.findOne({
        _id: position.tradingAccount,
        user: userId,
      }).session(session);

      if (!account) {
        throw new Error("Trading account not found.");
      }

      if (["breached", "completed", "closed"].includes(account.status)) {
        throw new Error(
          "This trading account is no longer available for manual trading.",
        );
      }

      const instrument = await MarketInstrument.findById(
        position.instrument,
      ).session(session);

      if (
        !instrument ||
        instrument.currentPrice === undefined ||
        instrument.currentPrice === null
      ) {
        throw new Error("The instrument's closing price is unavailable.");
      }

      if (
        instrument.priceSource !== "simulated" ||
        instrument.quoteCurrency !== "USD"
      ) {
        throw new Error("Only USD-quoted simulated instruments can be closed.");
      }

      const entryPrice = toDecimal(position.entryPrice, "Entry price");
      const closePrice = toDecimal(instrument.currentPrice, "Closing price");
      const quantity = toDecimal(position.quantity, "Quantity");
      const contractSize = toDecimal(position.contractSize, "Contract size");
      const positionMargin = toDecimal(position.marginUsed, "Position margin");

      if (
        !entryPrice.isPositive() ||
        !closePrice.isPositive() ||
        !quantity.isPositive() ||
        !contractSize.isPositive() ||
        positionMargin.isNegative()
      ) {
        throw new Error("Position pricing, quantity, or margin is invalid.");
      }

      if (!["buy", "sell"].includes(position.side)) {
        throw new Error("Position side is invalid.");
      }

      let realizedPnl = closePrice
        .minus(entryPrice)
        .times(quantity)
        .times(contractSize);

      if (position.side === "sell") {
        realizedPnl = realizedPnl.negated();
      }

      const oldBalance = toDecimal(account.balance, "Account balance");
      const oldUnrealizedPnl = toDecimal(
        account.unrealizedPnl,
        "Account unrealized P&L",
      );
      const oldUsedMargin = toDecimal(
        account.usedMargin,
        "Account used margin",
      );
      const positionUnrealizedPnl = toDecimal(
        position.unrealizedPnl,
        "Position unrealized P&L",
      );

      if (
        oldBalance.isNegative() ||
        oldUsedMargin.isNegative() ||
        positionMargin.greaterThan(oldUsedMargin)
      ) {
        throw new Error(
          "Account balance or margin is inconsistent. Review the account before closing.",
        );
      }

      // Apply the closing P&L once. Simulated cash cannot go below zero.
      const calculatedBalance = oldBalance.plus(realizedPnl);
      const newBalance = Decimal.max(0, calculatedBalance);

      // Remove this position's previous unrealized P&L.
      const newUnrealizedPnl = oldUnrealizedPnl.minus(positionUnrealizedPnl);

      const newUsedMargin = oldUsedMargin.minus(positionMargin);

      // Equity includes remaining open positions' unrealized P&L.
      const calculatedEquity = newBalance.plus(newUnrealizedPnl);
      const newEquity = Decimal.max(0, calculatedEquity);
      const newFreeMargin = Decimal.max(0, newEquity.minus(newUsedMargin));

      position.status = "closed";
      position.closedAt = new Date();
      position.closePrice = toDecimal128(closePrice);
      position.currentPrice = toDecimal128(closePrice);
      position.realizedPnl = toDecimal128(realizedPnl);
      position.unrealizedPnl = toDecimal128(new Decimal(0));

      await position.save({ session });

      account.balance = toDecimal128(newBalance);
      account.unrealizedPnl = toDecimal128(newUnrealizedPnl);
      account.equity = toDecimal128(newEquity);
      account.usedMargin = toDecimal128(newUsedMargin);
      account.freeMargin = toDecimal128(newFreeMargin);

      const previousHighestEquity = toDecimal(
        account.highestEquity,
        "Highest equity",
      );

      if (newEquity.greaterThan(previousHighestEquity)) {
        account.highestEquity = toDecimal128(newEquity);
      }

      if (calculatedBalance.lte(0)) {
        account.status = "breached";
        account.breachedAt = account.breachedAt || new Date();
      }

      const riskResult = await tradingRiskService.evaluateAccountRisk(
        account,
        session,
      );

      // A breach or completed challenge must not leave live positions open.
      if (["breached", "completed"].includes(riskResult.account.status)) {
        await positionLiquidationService.liquidateAccountPositions({
          accountId: account._id,
          session,
        });
      }

      result = {
        position,
        account: riskResult.account,
        realizedPnl: realizedPnl.toFixed(8),
        riskEvent: riskResult.riskEvent,
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
};
