const mongoose = require("mongoose");

const tradingEquitySnapshotSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    tradingAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingAccount",
      required: true,
      index: true,
    },

    balance: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    unrealizedPnl: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    equity: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    usedMargin: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    freeMargin: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    peakEquity: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    drawdownAmount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    drawdownPercent: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    event: {
      type: String,
      enum: [
        "account_created",
        "price_update",
        "position_closed",
        "position_opened",
        "risk_liquidation",
        "manual",
      ],
      default: "manual",
      required: true,
    },

    recordedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

tradingEquitySnapshotSchema.index({
  tradingAccount: 1,
  recordedAt: -1,
});

tradingEquitySnapshotSchema.index({
  user: 1,
  tradingAccount: 1,
  recordedAt: -1,
});

module.exports = mongoose.model(
  "TradingEquitySnapshot",
  tradingEquitySnapshotSchema,
);
