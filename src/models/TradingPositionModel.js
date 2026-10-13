
const mongoose = require("mongoose");

const tradingPositionSchema = new mongoose.Schema(
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

    instrument: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MarketInstrument",
      required: true,
    },

    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingOrder",
      required: true,
    },

    symbol: {
      type: String,
      required: true,
      uppercase: true,
    },

    side: {
      type: String,
      enum: ["buy", "sell"],
      required: true,
    },

    quantity: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    contractSize: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    entryPrice: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    currentPrice: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    notionalValue: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    marginUsed: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    unrealizedPnl: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
      required: true,
    },

    stopLoss: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
    },

    takeProfit: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
    },

    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
      required: true,
      index: true,
    },

    closedAt: {
      type: Date,
      default: null,
    },

    closePrice: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
    },

    realizedPnl: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

tradingPositionSchema.index({
  tradingAccount: 1,
  status: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  "TradingPosition",
  tradingPositionSchema
);
