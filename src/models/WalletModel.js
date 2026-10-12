const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    baseCurrency: {
      type: String,
      enum: ["USD"],
      default: "USD",
      required: true,
    },

    displayCurrency: {
      type: String,
      enum: ["USD", "NGN", "CAD", "EUR"],
      default: "USD",
      required: true,
      uppercase: true,
      trim: true,
    },

    availableBalance: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
      required: true,
    },

    lockedBalance: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
      required: true,
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

// Exactly one wallet document per user.
walletSchema.index(
  { user: 1 },
  { unique: true, name: "unique_wallet_per_user" },
);

module.exports = mongoose.model("Wallet", walletSchema);
