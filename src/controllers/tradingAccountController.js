const mongoose = require("mongoose");
const TradingAccount = require("../models/TradingAccountModel");

const STARTING_BALANCE = "5000";

const ALLOWED_ACCOUNT_TYPES = ["demo", "challenge", "evaluation"];

const getUserId = (req) => req.user?._id || req.user?.id;

const getUtcDateKey = () => new Date().toISOString().slice(0, 10);

// CREATE TRADING ACCOUNT
exports.createTradingAccount = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication is required.",
      });
    }

    const accountType = String(req.body.accountType || "demo")
      .trim()
      .toLowerCase();

    if (!ALLOWED_ACCOUNT_TYPES.includes(accountType)) {
      return res.status(400).json({
        status: "error",
        message: "Account type must be demo, challenge, or evaluation.",
      });
    }

    // All account money fields are initialized by the server.
    // Do not accept balances, leverage, or risk limits from req.body.
    const startingBalance =
      mongoose.Types.Decimal128.fromString(STARTING_BALANCE);

    const account = await TradingAccount.create({
      user: userId,
      accountType,
      status: "active",
      currency: "USD",

      initialBalance: startingBalance,
      balance: startingBalance,
      unrealizedPnl: mongoose.Types.Decimal128.fromString("0"),
      equity: startingBalance,
      usedMargin: mongoose.Types.Decimal128.fromString("0"),
      freeMargin: startingBalance,

      leverage: 100,

      profitTargetPercent: accountType === "demo" ? 0 : 10,

      maxDailyLossPercent: 5,
      maxOverallDrawdownPercent: 10,

      dailyStartingEquity: startingBalance,
      dailyLossDate: getUtcDateKey(),
      highestEquity: startingBalance,

      startedAt: new Date(),
    });

    return res.status(201).json({
      status: "success",
      message: "Simulated trading account created successfully.",
      data: {
        account,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET ALL ACCOUNTS BELONGING TO THE LOGGED-IN USER
exports.getMyTradingAccounts = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication is required.",
      });
    }

    const accounts = await TradingAccount.find({
      user: userId,
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      status: "success",
      results: accounts.length,
      data: {
        accounts,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET ONE ACCOUNT OWNED BY THE LOGGED-IN USER
exports.getMyTradingAccount = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication is required.",
      });
    }

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid trading account ID.",
      });
    }

    const account = await TradingAccount.findOne({
      _id: id,
      user: userId,
    });

    if (!account) {
      return res.status(404).json({
        status: "error",
        message: "Trading account not found.",
      });
    }

    return res.status(200).json({
      status: "success",
      data: {
        account,
      },
    });
  } catch (error) {
    next(error);
  }
};
