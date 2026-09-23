const mongoose = require("mongoose");

const ledgerEntrySchema = new mongoose.Schema(
  {
    /*
    =================================================
    WALLET
    =================================================
    */

    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
      index: true,
    },

    /*
    =================================================
    USER
    =================================================
    */

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /*
    =================================================
    TRANSACTION TYPE
    =================================================
    */

    type: {
      type: String,
      enum: [
        "DEPOSIT",
        "WITHDRAWAL",
        "TRADE",
        "FEE",
        "REFUND",
        "BONUS",
        "ADJUSTMENT",
        "TRANSFER",
      ],
      required: true,
      index: true,
    },

    /*
    =================================================
    DIRECTION
    =================================================
    */

    direction: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
      required: true,
    },

    /*
    =================================================
    AMOUNT
    =================================================
    */

    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    /*
    =================================================
    CURRENCY
    =================================================
    */

    currency: {
      type: String,
      enum: ["USD", "NGN", "CAD", "EUR"],
      required: true,
      uppercase: true,
    },

    /*
    =================================================
    BALANCE AFTER TRANSACTION
    =================================================
    */

    balanceAfter: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    /*
    =================================================
    REFERENCE
    =================================================
    */

    reference: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },

    /*
    =================================================
    DESCRIPTION
    =================================================
    */

    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },

    /*
    =================================================
    METADATA
    =================================================
    */

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /*
    =================================================
    IMMUTABLE
    =================================================
    */

    immutable: {
      type: Boolean,
      default: true,
      immutable: true,
    },
  },
  {
    timestamps: true,
  },
);

/*
=====================================================
INDEXES
=====================================================
*/

ledgerEntrySchema.index({
  wallet: 1,
  createdAt: -1,
});

ledgerEntrySchema.index({
  user: 1,
  createdAt: -1,
});

ledgerEntrySchema.index({
  reference: 1,
  createdAt: -1,
});

/*
=====================================================
BLOCK LEDGER UPDATES
=====================================================

Ledger records should be append-only.
=====================================================
*/

ledgerEntrySchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne"],
  function (next) {
    return next(
      new Error("Ledger entries are immutable and cannot be modified."),
    );
  },
);

/*
=====================================================
BLOCK LEDGER DELETIONS
=====================================================
*/

ledgerEntrySchema.pre(
  ["deleteOne", "deleteMany", "findOneAndDelete", "findOneAndRemove"],
  function (next) {
    return next(
      new Error("Ledger entries are immutable and cannot be deleted."),
    );
  },
);

module.exports = mongoose.model("LedgerEntry", ledgerEntrySchema);
