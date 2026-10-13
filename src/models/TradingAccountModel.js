const mongoose = require("mongoose");
const crypto = require("crypto");

const tradingAccountSchema = new mongoose.Schema(
  {
    // Account owner
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Unique trading account number
    accountNumber: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: () =>
        `TRD-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    },

    // Account classification
    accountType: {
      type: String,
      enum: ["demo", "challenge", "evaluation"],
      default: "demo",
      required: true,
    },

    // Simulated account lifecycle
    status: {
      type: String,
      enum: [
        "active",
        "paused",
        "breached",
        "completed",
        "closed",
      ],
      default: "active",
      required: true,
      index: true,
    },

    // All trading account values are denominated in USD.
    currency: {
      type: String,
      enum: ["USD"],
      default: "USD",
      required: true,
      immutable: true,
    },

    // Set by the backend when the account is created.
    initialBalance: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      min: 0,
    },

    // Account balance after realized trading P&L and fees.
    balance: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      min: 0,
    },

    // Current unrealized profit/loss from open positions.
    unrealizedPnl: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
      required: true,
    },

    // Current account equity = balance + unrealized P&L.
    equity: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      min: 0,
    },

    // Margin reserved for open simulated positions.
    usedMargin: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
      required: true,
      min: 0,
    },

    // Updated by the trading engine.
    freeMargin: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      min: 0,
    },

    leverage: {
      type: Number,
      default: 100,
      min: 1,
      max: 500,
      required: true,
    },

    // Risk limits stored as percentages.
    profitTargetPercent: {
      type: Number,
      default: 10,
      min: 0,
      max: 100,
    },

    maxDailyLossPercent: {
      type: Number,
      default: 5,
      min: 0,
      max: 100,
    },

    maxOverallDrawdownPercent: {
      type: Number,
      default: 10,
      min: 0,
      max: 100,
    },

    // Daily risk tracking.
    dailyStartingEquity: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    dailyLossDate: {
      type: String,
      required: true,
    },

    // Historical high-water mark for drawdown calculations.
    highestEquity: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    startedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },

    breachedAt: {
      type: Date,
      default: null,
    },

    closedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Common account queries.
tradingAccountSchema.index({
  user: 1,
  status: 1,
});

tradingAccountSchema.index({
  user: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  "TradingAccount",
  tradingAccountSchema
);
