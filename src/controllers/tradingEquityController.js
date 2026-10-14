const mongoose = require("mongoose");

const TradingAccount = require("../models/TradingAccountModel");
const TradingEquitySnapshot = require("../models/TrdingEquitySnapShotModel");

const getUserId = (req) => req.user?._id ?? req.user?.id;

const toNumber = (value) => {
  if (value === undefined || value === null) return 0;
  const result = Number(value.toString());
  return Number.isFinite(result) ? result : 0;
};

const parseDate = (value, fieldName, endOfDay = false) => {
  if (!value) return null;

  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a valid date.`);
  }

  // A date-only "to" includes the entire specified UTC day.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (dateOnly) {
    const parsed = new Date(`${value}T00:00:00.000Z`);

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      throw new Error(`${fieldName} is invalid.`);
    }

    if (endOfDay) parsed.setUTCDate(parsed.getUTCDate() + 1);

    return parsed;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid date.`);
  }

  return parsed;
};

exports.getEquityHistory = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { accountId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required.",
      });
    }

    if (!mongoose.isValidObjectId(accountId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid trading account ID.",
      });
    }

    const account = await TradingAccount.findOne({
      _id: accountId,
      user: userId,
    }).select(
      "_id user accountType status currency initialBalance balance equity unrealizedPnl highestEquity usedMargin freeMargin",
    );

    if (!account) {
      return res.status(404).json({
        status: "error",
        message: "Trading account not found.",
      });
    }

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to", true);

    if (from && to && from >= to) {
      return res.status(400).json({
        status: "error",
        message: "'from' must be earlier than 'to'.",
      });
    }

    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(1000, Math.max(1, requestedLimit))
      : 500;

    const query = {
      user: userId,
      tradingAccount: account._id,
    };

    if (from || to) {
      query.recordedAt = {};

      if (from) query.recordedAt.$gte = from;
      if (to) query.recordedAt.$lt = to;
    }

    // Fetch newest snapshots first so the limit selects the latest history.
    const snapshots = await TradingEquitySnapshot.find(query)
      .sort({ recordedAt: -1, _id: -1 })
      .limit(limit)
      .lean();

    // Return the selected records in chronological order for charting.
    snapshots.reverse();

    const points = snapshots.map((snapshot) => ({
      id: String(snapshot._id),
      recordedAt: snapshot.recordedAt,
      event: snapshot.event,
      balance: toNumber(snapshot.balance),
      unrealizedPnl: toNumber(snapshot.unrealizedPnl),
      equity: toNumber(snapshot.equity),
      usedMargin: toNumber(snapshot.usedMargin),
      freeMargin: toNumber(snapshot.freeMargin),
      peakEquity: toNumber(snapshot.peakEquity),
      drawdownAmount: toNumber(snapshot.drawdownAmount),
      drawdownPercent: toNumber(snapshot.drawdownPercent),
    }));

    const maxDrawdownAmount = points.reduce(
      (maximum, point) => Math.max(maximum, point.drawdownAmount),
      0,
    );

    const maxDrawdownPercent = points.reduce(
      (maximum, point) => Math.max(maximum, point.drawdownPercent),
      0,
    );

    const latestSnapshot = points.at(-1);

    return res.status(200).json({
      status: "success",
      data: {
        account: {
          id: String(account._id),
          accountType: account.accountType,
          status: account.status,
          currency: account.currency || "USD",
          initialBalance: toNumber(account.initialBalance),
          balance: toNumber(account.balance),
          equity: toNumber(account.equity),
          unrealizedPnl: toNumber(account.unrealizedPnl),
          highestEquity: toNumber(account.highestEquity),
          usedMargin: toNumber(account.usedMargin),
          freeMargin: toNumber(account.freeMargin),
        },
        summary: {
          snapshotCount: points.length,
          maxDrawdownAmount,
          maxDrawdownPercent,
          latestSnapshotAt: latestSnapshot?.recordedAt ?? null,
        },
        points,
      },
    });
  } catch (error) {
    if (
      error.message?.includes("must be a valid date") ||
      error.message?.includes("is invalid") ||
      error.message?.includes("earlier than")
    ) {
      return res.status(400).json({
        status: "error",
        message: error.message,
      });
    }

    next(error);
  }
};
