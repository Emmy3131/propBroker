const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    currency: {
      type: String,
      enum: ["USD", "NGN", "CAD", "EUR"],
      required: true,
      uppercase: true,
      trim: true,
    },

    availableBalance: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
    },

    lockedBalance: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
    },

    status: {
      type: String,
      enum: ["active", "frozen", "closed"],
      default: "active",
      index: true,
    },

    lastTransactionAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

/*
=====================================================
ONE WALLET PER USER PER CURRENCY
=====================================================
*/

walletSchema.index(
  {
    user: 1,
    currency: 1,
  },
  {
    unique: true,
  },
);

module.exports = mongoose.model("Wallet", walletSchema);
