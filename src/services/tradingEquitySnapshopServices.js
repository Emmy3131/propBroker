const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const TradingAccount = require("../models/TradingAccountModel");
const TradingEquitySnapshot = require("../models/TrdingEquitySnapShotModel");

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

exports.recordSnapshot = async ({ accountId, session, event = "manual" }) => {
  if (!mongoose.isValidObjectId(accountId)) {
    throw new Error("Invalid trading account ID.");
  }

  const accountQuery = TradingAccount.findById(accountId);

  if (session) {
    accountQuery.session(session);
  }

  const account = await accountQuery;

  if (!account) {
    throw new Error("Trading account not found.");
  }

  const balance = toDecimal(account.balance, "Account balance");
  const unrealizedPnl = toDecimal(
    account.unrealizedPnl,
    "Account unrealized P&L",
  );
  const equity = toDecimal(account.equity, "Account equity");
  const usedMargin = toDecimal(account.usedMargin, "Used margin");
  const freeMargin = toDecimal(account.freeMargin, "Free margin");
  const accountHigh = toDecimal(
    account.highestEquity,
    "Account highest equity",
  );

  const latestQuery = TradingEquitySnapshot.findOne({
    tradingAccount: account._id,
  }).sort({ recordedAt: -1, _id: -1 });

  if (session) {
    latestQuery.session(session);
  }

  const latest = await latestQuery;

  const previousPeak = latest
    ? toDecimal(latest.peakEquity, "Previous peak equity")
    : new Decimal(0);

  const peakEquity = Decimal.max(
    new Decimal(0),
    accountHigh,
    previousPeak,
    equity,
  );

  const drawdownAmount = Decimal.max(0, peakEquity.minus(equity));

  const drawdownPercent = peakEquity.isPositive()
    ? drawdownAmount.dividedBy(peakEquity).times(100)
    : new Decimal(0);

  // Keep the account's high-water mark synchronized.
  if (peakEquity.gt(accountHigh)) {
    account.highestEquity = toDecimal128(peakEquity);
    await account.save(session ? { session } : {});
  }

  const snapshot = new TradingEquitySnapshot({
    user: account.user,
    tradingAccount: account._id,
    balance: toDecimal128(balance),
    unrealizedPnl: toDecimal128(unrealizedPnl),
    equity: toDecimal128(equity),
    usedMargin: toDecimal128(usedMargin),
    freeMargin: toDecimal128(freeMargin),
    peakEquity: toDecimal128(peakEquity),
    drawdownAmount: toDecimal128(drawdownAmount),
    drawdownPercent: toDecimal128(drawdownPercent),
    event,
    recordedAt: new Date(),
  });

  await snapshot.save(session ? { session } : {});

  return snapshot;
};
