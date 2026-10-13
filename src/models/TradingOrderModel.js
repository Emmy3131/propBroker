
const mongoose = require("mongoose");

const tradingOrderSchema = new mongoose.Schema(
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

    orderType: {
      type: String,
      enum: ["market"],
      default: "market",
      required: true,
    },

    quantity: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    requestedPrice: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    executionPrice: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    status: {
      type: String,
      enum: ["filled", "rejected", "cancelled"],
      default: "filled",
      required: true,
      index: true,
    },

    position: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingPosition",
      default: null,
    },

    rejectionReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

tradingOrderSchema.index({ user: 1, createdAt: -1 });
tradingOrderSchema.index({ tradingAccount: 1, createdAt: -1 });

module.exports = mongoose.model("TradingOrder", tradingOrderSchema);
