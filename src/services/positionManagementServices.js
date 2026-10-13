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

  const result = new Decimal(value.toString());

  if (!result.isFinite()) {
    throw new Error(`${fieldName} is invalid.`);
  }

  return result;
};

const toDecimal128 = (value) =>
  mongoose.Types.Decimal128.fromString(value.toFixed(8));

exports.closePosition = async ({ userId, positionId }) => {
  if (!mongoose.isValidObjectId(positionId)) {
    throw new Error("Invalid position ID.");
  }

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      // Find an open position owned by this user.
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

      // Use the latest stored simulated instrument price.
      const instrument = await MarketInstrument.findById(
        position.instrument,
      ).session(session);

      if (!instrument || !instrument.currentPrice) {
        throw new Error("The instrument's closing price is unavailable.");
      }

      if (
        instrument.priceSource !== "simulated" ||
        instrument.quoteCurrency !== "USD"
      ) {
        throw new Error(
          "This simulator can only close USD-quoted simulated instruments.",
        );
      }

      const entryPrice = toDecimal(position.entryPrice, "Entry price");

      const closePrice = toDecimal(instrument.currentPrice, "Closing price");

      const quantity = toDecimal(position.quantity, "Quantity");
      const contractSize = toDecimal(position.contractSize, "Contract size");

      if (
        !entryPrice.isPositive() ||
        !closePrice.isPositive() ||
        !quantity.isPositive() ||
        !contractSize.isPositive()
      ) {
        throw new Error("Position pricing or quantity is invalid.");
      }

      // P&L = price movement × quantity × contract size.
      let realizedPnl = closePrice
        .minus(entryPrice)
        .times(quantity)
        .times(contractSize);

      // A sell position profits when the price falls.
      if (position.side === "sell") {
        realizedPnl = realizedPnl.negated();
      }

      const oldBalance = toDecimal(account.balance, "Account balance");
      const oldUnrealizedPnl = toDecimal(
        account.unrealizedPnl,
        "Unrealized P&L",
      );
      const oldUsedMargin = toDecimal(account.usedMargin, "Used margin");
      const positionMargin = toDecimal(position.marginUsed, "Position margin");

      if (positionMargin.greaterThan(oldUsedMargin)) {
        throw new Error(
          "Position margin exceeds account used margin. Review the account before closing.",
        );
      }

      // Never allow the simulated account balance to fall below zero.
      const calculatedBalance = oldBalance.plus(realizedPnl);
      const newBalance = Decimal.max(0, calculatedBalance);

      // Remove this position's previously recorded unrealized P&L.
      const newUnrealizedPnl = oldUnrealizedPnl.minus(
        toDecimal(position.unrealizedPnl, "Position unrealized P&L"),
      );

      const newUsedMargin = oldUsedMargin.minus(positionMargin);
      const calculatedEquity = newBalance.plus(newUnrealizedPnl);
      const newEquity = Decimal.max(0, calculatedEquity);
      const newFreeMargin = Decimal.max(0, newEquity.minus(newUsedMargin));

      // Finalize the position.
      position.status = "closed";
      position.closedAt = new Date();
      position.closePrice = toDecimal128(closePrice);
      position.currentPrice = toDecimal128(closePrice);
      position.realizedPnl = toDecimal128(realizedPnl);
      position.unrealizedPnl = toDecimal128(new Decimal(0));

      await position.save({ session });

      // Update the trading account, never the user's real wallet.
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

      // A zero-balance account cannot continue trading.
      if (calculatedBalance.lte(0)) {
        account.balance = toDecimal128(new Decimal(0));
        account.equity = toDecimal128(Decimal.max(0, newUnrealizedPnl));
        account.freeMargin = toDecimal128(
          Decimal.max(0, newEquity.minus(newUsedMargin)),
        );
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

      result = {
        position,
        account,
        realizedPnl: realizedPnl.toFixed(8),
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
};
