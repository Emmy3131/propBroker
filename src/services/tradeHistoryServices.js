const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const TradingAccount = require("../models/TradingAccountModel");
const TradingPosition = require("../models/TradingPositionModel");

const toDecimal = (value) =>
  new Decimal(value == null ? "0" : value.toString());

const money = (value) =>
  value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

const getOwnedAccount = async (userId, accountId) => {
  if (!mongoose.isValidObjectId(accountId)) {
    throw new Error("Invalid trading account ID.");
  }

  const account = await TradingAccount.findOne({
    _id: accountId,
    user: userId,
  }).lean();

  if (!account) {
    throw new Error("Trading account not found.");
  }

  return account;
};

/*
=====================================================
DATE FILTER HELPERS
=====================================================
A date-only "to" value includes the entire selected day.

For example:
to=2026-10-14
includes trades closed throughout October 14.

Datetime values remain precise.
=====================================================
*/

const parseDateFilter = (value, isEndDate = false) => {
  if (!value) return null;

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date filter.");
  }

  // Reject impossible calendar dates such as 2026-02-31.
  if (isDateOnly && parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid date filter.");
  }

  if (isDateOnly && isEndDate) {
    parsed.setUTCDate(parsed.getUTCDate() + 1);
  }

  return parsed;
};

const buildClosedTradeFilter = ({
  userId,
  accountId,
  side,
  result,
  from,
  to,
}) => {
  const filter = {
    user: userId,
    status: "closed",
  };

  if (accountId) filter.tradingAccount = accountId;
  if (side) filter.side = side;

  if (result === "win") {
    filter.realizedPnl = { $gt: 0 };
  } else if (result === "loss") {
    filter.realizedPnl = { $lt: 0 };
  } else if (result === "breakeven") {
    filter.realizedPnl = { $eq: 0 };
  }

  const startDate = parseDateFilter(from);
  const endDate = parseDateFilter(to, true);

  if (startDate || endDate) {
    filter.closedAt = {};

    if (startDate) {
      filter.closedAt.$gte = startDate;
    }

    if (endDate) {
      // Exclusive end boundary handles date-only filters correctly.
      filter.closedAt.$lt = endDate;
    }
  }

  return filter;
};

/*
=====================================================
TRADE HISTORY
=====================================================
*/

exports.getTradeHistory = async ({
  userId,
  accountId,
  side,
  result,
  from,
  to,
  page = 1,
  limit = 20,
}) => {
  if (accountId) {
    await getOwnedAccount(userId, accountId);
  }

  const filter = buildClosedTradeFilter({
    userId,
    accountId,
    side,
    result,
    from,
    to,
  });

  const skip = (page - 1) * limit;

  const [trades, total] = await Promise.all([
    TradingPosition.find(filter)
      .select(
        [
          "tradingAccount",
          "instrument",
          "order",
          "symbol",
          "side",
          "quantity",
          "contractSize",
          "entryPrice",
          "closePrice",
          "currentPrice",
          "realizedPnl",
          "status",
          "openedAt",
          "closedAt",
          "createdAt",
          "updatedAt",
        ].join(" ")
      )
      .populate("tradingAccount", "accountNumber accountType")
      .populate("instrument", "symbol name assetClass")
      .sort({ closedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    TradingPosition.countDocuments(filter),
  ]);

  return {
    trades,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
    },
  };
};

/*
=====================================================
ACCOUNT PERFORMANCE
=====================================================
Performance metrics use closed positions.

Current drawdown below means loss relative to the
initial balance. It is NOT historical peak-to-trough
maximum drawdown; that requires equity snapshots.
=====================================================
*/

exports.getAccountPerformance = async ({ userId, accountId }) => {
  const account = await getOwnedAccount(userId, accountId);

  const closedTrades = await TradingPosition.find({
    user: userId,
    tradingAccount: account._id,
    status: "closed",
  })
    .select("realizedPnl side")
    .lean();

  let grossProfit = new Decimal(0);
  let grossLoss = new Decimal(0);
  let netProfit = new Decimal(0);

  let winningTrades = 0;
  let losingTrades = 0;
  let breakevenTrades = 0;
  let buyTrades = 0;
  let sellTrades = 0;

  for (const trade of closedTrades) {
    const pnl = toDecimal(trade.realizedPnl);

    netProfit = netProfit.plus(pnl);

    if (pnl.gt(0)) {
      grossProfit = grossProfit.plus(pnl);
      winningTrades += 1;
    } else if (pnl.lt(0)) {
      grossLoss = grossLoss.plus(pnl.abs());
      losingTrades += 1;
    } else {
      breakevenTrades += 1;
    }

    if (trade.side === "buy") buyTrades += 1;
    if (trade.side === "sell") sellTrades += 1;
  }

  const totalClosedTrades = closedTrades.length;

  const initialBalance = toDecimal(account.initialBalance);
  const balance = toDecimal(account.balance);
  const equity = toDecimal(account.equity);
  const unrealizedPnl = toDecimal(account.unrealizedPnl);
  const highestEquity = toDecimal(account.highestEquity);
  const profitTargetPercent = toDecimal(account.profitTargetPercent);

  const targetProfit = initialBalance.times(
    profitTargetPercent.div(100)
  );

  // Equity includes unrealized P&L, so this is current account
  // profit toward the target, not realized P&L alone.
  const achievedProfit = equity.minus(initialBalance);

  const targetProgress =
    targetProfit.gt(0)
      ? achievedProfit.div(targetProfit).times(100)
      : new Decimal(0);

  // This metric is measured from initial balance, consistent
  // with the platform's fixed initial-balance drawdown rules.
  const currentDrawdownAmount = Decimal.max(
    0,
    initialBalance.minus(equity)
  );

  const currentDrawdownPercent =
    initialBalance.gt(0)
      ? currentDrawdownAmount.div(initialBalance).times(100)
      : new Decimal(0);

  const profitFactor =
    grossLoss.gt(0)
      ? Number(grossProfit.div(grossLoss).toFixed(2))
      : null;

  const winRate =
    totalClosedTrades > 0
      ? new Decimal(winningTrades)
          .div(totalClosedTrades)
          .times(100)
      : new Decimal(0);

  return {
    account: {
      id: account._id,
      accountNumber: account.accountNumber,
      accountType: account.accountType,
      status: account.status,
      currency: account.currency,
    },

    balances: {
      initialBalance: money(initialBalance),
      balance: money(balance),
      equity: money(equity),
      unrealizedPnl: money(unrealizedPnl),
      highestEquity: money(highestEquity),
    },

    performance: {
      totalClosedTrades,
      winningTrades,
      losingTrades,
      breakevenTrades,
      winRatePercent: money(winRate),
      grossProfit: money(grossProfit),
      grossLoss: money(grossLoss.negated()),
      netRealizedPnl: money(netProfit),
      profitFactor,
      buyTrades,
      sellTrades,
    },

    challenge: {
      profitTargetPercent: Number(
        profitTargetPercent.toString()
      ),
      targetProfit: money(targetProfit),
      achievedProfit: money(achievedProfit),
      targetProgressPercent: Number(
        Decimal.max(
          0,
          Decimal.min(100, targetProgress)
        ).toFixed(2)
      ),
      drawdownAmount: money(currentDrawdownAmount),
      drawdownPercent: money(currentDrawdownPercent),
      highestEquity: money(highestEquity),
      isDemo: account.accountType === "demo",
    },
  };
};