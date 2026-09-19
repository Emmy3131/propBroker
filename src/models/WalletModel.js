const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema(
  {
    /*
    =================================================
    OWNER
    =================================================
    */

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    /*
    =================================================
    CURRENCY
    =================================================
    */

    currency: {
      type: String,
      enum: ["USD", "NGN", "CAD", "EUR"],
      default: "USD",
      uppercase: true,
      trim: true,
    },

    /*
    =================================================
    AVAILABLE BALANCE
    =================================================
    */

    availableBalance: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
    },

    /*
    =================================================
    LOCKED BALANCE
    =================================================

    Examples:

    - Pending withdrawal
    - Reserved trading funds
    - Financial holds
    */

    lockedBalance: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
    },

    /*
    =================================================
    WALLET STATUS
    =================================================
    */

    status: {
      type: String,
      enum: ["active", "frozen", "closed"],
      default: "active",
      index: true,
    },

    /*
    =================================================
    LAST TRANSACTION
    =================================================
    */

    lastTransactionAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Wallet", walletSchema);
