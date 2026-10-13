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

  if (from || to) {
    filter.closedAt = {};

    if (from) filter.closedAt.$gte = new Date(from);
    if (to) filter.closedAt.$lte = new Date(to);
  }

  return filter;
};

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
        "tradingAccount instrument order symbol side quantity contractSize entryPrice closePrice currentPrice realizedPnl status openedAt closedAt createdAt updatedAt",
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

  const targetProfit = initialBalance.times(profitTargetPercent.div(100));

  const achievedProfit = equity.minus(initialBalance);

  const targetProgress = targetProfit.gt(0)
    ? achievedProfit.div(targetProfit).times(100)
    : new Decimal(0);

  const drawdownAmount = Decimal.max(0, initialBalance.minus(equity));

  const drawdownPercent = initialBalance.gt(0)
    ? drawdownAmount.div(initialBalance).times(100)
    : new Decimal(0);

  const profitFactor = grossLoss.gt(0) ? grossProfit.div(grossLoss) : null;

  const winRate =
    totalClosedTrades > 0
      ? new Decimal(winningTrades).div(totalClosedTrades).times(100)
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
      profitFactor:
        profitFactor === null ? null : Number(profitFactor.toFixed(2)),
      buyTrades,
      sellTrades,
    },

    challenge: {
      profitTargetPercent: Number(profitTargetPercent.toString()),
      targetProfit: money(targetProfit),
      achievedProfit: money(achievedProfit),
      targetProgressPercent: Number(
        Decimal.max(0, Decimal.min(100, targetProgress)).toFixed(2),
      ),
      drawdownAmount: money(drawdownAmount),
      drawdownPercent: money(drawdownPercent),
      highestEquity: money(highestEquity),
      isDemo: account.accountType === "demo",
    },
  };
};
