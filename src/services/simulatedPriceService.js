const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const MarketInstrument = require("../models/MarketInstrumentModel");
const TradingPosition = require("../models/TradingPositionModel");
const TradingAccount = require("../models/TradingAccountModel");
const tradingRiskService = require("./tradingRiskService");
const positionLiquidationService = require("./positionLiquidationServices");

const decimal = (value, label) => {
  if (value === undefined || value === null) {
    throw new Error(`${label} is missing.`);
  }

  const result = new Decimal(value.toString());

  if (!result.isFinite()) {
    throw new Error(`${label} is invalid.`);
  }

  return result;
};

const decimal128 = (value) =>
  mongoose.Types.Decimal128.fromString(value.toFixed(8));

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
  let result;

  try {
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

      // Save the new simulated market price.
      instrument.currentPrice = decimal128(newPrice);
      instrument.priceUpdatedAt = new Date();

      await instrument.save({ session });

      // Find all open positions for this instrument.
      const positions = await TradingPosition.find({
        instrument: instrument._id,
        status: "open",
      }).session(session);

      const affectedAccountIds = new Set();

      for (const position of positions) {
        const pnl = calculatePositionPnl(position, newPrice);

        position.currentPrice = decimal128(newPrice);
        position.unrealizedPnl = decimal128(pnl);

        await position.save({ session });

        affectedAccountIds.add(position.tradingAccount.toString());
      }

      // Recalculate each affected account from its open positions.
      for (const accountId of affectedAccountIds) {
        const account = await TradingAccount.findOne({
          _id: accountId,
        }).session(session);

        if (!account) {
          continue;
        }

        const openPositions = await TradingPosition.find({
          tradingAccount: account._id,
          status: "open",
        }).session(session);

        let totalUnrealizedPnl = new Decimal(0);
        let totalUsedMargin = new Decimal(0);

        for (const position of openPositions) {
          totalUnrealizedPnl = totalUnrealizedPnl.plus(
            decimal(position.unrealizedPnl, "Position P&L"),
          );

          totalUsedMargin = totalUsedMargin.plus(
            decimal(position.marginUsed, "Position margin"),
          );
        }

        const balance = decimal(account.balance, "Account balance");
        const equity = balance.plus(totalUnrealizedPnl);
        const freeMargin = Decimal.max(0, equity.minus(totalUsedMargin));

        account.unrealizedPnl = decimal128(totalUnrealizedPnl);
        account.usedMargin = decimal128(totalUsedMargin);
        account.equity = decimal128(Decimal.max(0, equity));
        account.freeMargin = decimal128(freeMargin);

        const highestEquity = decimal(account.highestEquity, "Highest equity");

        if (equity.greaterThan(highestEquity)) {
          account.highestEquity = decimal128(equity);
        }

        // Basic safety stop. Full drawdown rules come next.
        if (equity.lte(0) && account.status !== "breached") {
          account.status = "breached";
          account.breachedAt = new Date();
        }

        const riskResult = await tradingRiskService.evaluateAccountRisk(
          account,
          session,
        );

        if (riskResult.account.status === "breached") {
          await positionLiquidationService.liquidateAccountPositions({
            accountId: account._id,
            session,
          });
        }
      }

      result = {
        symbol: instrument.symbol,
        price: newPrice.toFixed(8),
        updatedPositions: positions.length,
        updatedAccounts: affectedAccountIds.size,
        priceUpdatedAt: instrument.priceUpdatedAt,
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
};
