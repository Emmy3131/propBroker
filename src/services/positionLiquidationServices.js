const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const TradingAccount = require("../models/TradingAccountModel");
const TradingPosition = require("../models/TradingPositionModel");
const MarketInstrument = require("../models/MarketInstrumentModel");

const toDecimal = (value, label) => {
  if (value === undefined || value === null) {
    throw new Error(`${label} is missing.`);
  }

  const result = new Decimal(value.toString());

  if (!result.isFinite()) {
    throw new Error(`${label} is invalid.`);
  }

  return result;
};

const toDecimal128 = (value) =>
  mongoose.Types.Decimal128.fromString(
    value.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8),
  );

exports.liquidateAccountPositions = async ({ accountId, session }) => {
  if (!session) {
    throw new Error("A MongoDB transaction session is required.");
  }

  const account = await TradingAccount.findById(accountId).session(session);

  if (!account) {
    throw new Error("Trading account not found.");
  }

  if (account.status !== "breached") {
    return {
      liquidated: false,
      reason: "account_not_breached",
      closedPositions: 0,
    };
  }

  const positions = await TradingPosition.find({
    tradingAccount: account._id,
    status: "open",
  }).session(session);

  let balance = toDecimal(account.balance, "Account balance");
  let realizedPnlTotal = new Decimal(0);
  let closedPositions = 0;

  for (const position of positions) {
    const instrument = await MarketInstrument.findById(
      position.instrument,
    ).session(session);

    if (
      !instrument ||
      instrument.priceSource !== "simulated" ||
      instrument.quoteCurrency !== "USD"
    ) {
      throw new Error(
        `Cannot liquidate position ${position._id}: unsupported or unavailable instrument price.`,
      );
    }

    const closePrice = toDecimal(instrument.currentPrice, "Closing price");
    const entryPrice = toDecimal(position.entryPrice, "Entry price");
    const quantity = toDecimal(position.quantity, "Position quantity");
    const contractSize = toDecimal(position.contractSize, "Contract size");

    if (
      !closePrice.isPositive() ||
      !entryPrice.isPositive() ||
      !quantity.isPositive() ||
      !contractSize.isPositive()
    ) {
      throw new Error(
        `Cannot liquidate position ${position._id}: invalid position values.`,
      );
    }

    let realizedPnl = closePrice
      .minus(entryPrice)
      .times(quantity)
      .times(contractSize);

    if (position.side === "sell") {
      realizedPnl = realizedPnl.negated();
    }

    balance = balance.plus(realizedPnl);
    realizedPnlTotal = realizedPnlTotal.plus(realizedPnl);

    position.status = "closed";
    position.closedAt = new Date();
    position.closePrice = toDecimal128(closePrice);
    position.currentPrice = toDecimal128(closePrice);
    position.realizedPnl = toDecimal128(realizedPnl);
    position.unrealizedPnl = toDecimal128(new Decimal(0));

    await position.save({ session });
    closedPositions += 1;
  }

  // Prevent a negative simulated cash balance.
  balance = Decimal.max(0, balance);

  account.balance = toDecimal128(balance);
  account.unrealizedPnl = toDecimal128(new Decimal(0));
  account.usedMargin = toDecimal128(new Decimal(0));
  account.equity = toDecimal128(balance);
  account.freeMargin = toDecimal128(balance);

  // Keep the breached status and breach timestamp intact.
  if (!account.breachedAt) {
    account.breachedAt = new Date();
  }

  await account.save({ session });

  return {
    liquidated: true,
    accountId: account._id,
    closedPositions,
    realizedPnl: realizedPnlTotal.toFixed(8),
    finalBalance: balance.toFixed(8),
    status: account.status,
  };
};
