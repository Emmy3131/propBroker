const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    currency: {
      type: String,
      enum: ["USD", "NGN", "CAD", "EUR"],
      default: "USD",
      uppercase: true,
      trim: true,
    },
    /* * Money currently available for use. */ availableBalance: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
    },
    /* * Money temporarily reserved. * * Examples: * - pending withdrawal * - reserved trading funds * - other financial holds */ lockedBalance:
      { type: mongoose.Schema.Types.Decimal128, default: 0 },
    status: {
      type: String,
      enum: ["active", "frozen", "closed"],
      default: "active",
      index: true,
    },
    lastTransactionAt: { type: Date, default: null },
  },
  { timestamps: true },
);
walletSchema.index({ user: 1, status: 1 });
module.exports = mongoose.model("Wallet", walletSchema);
