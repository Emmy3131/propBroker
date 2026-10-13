const mongoose = require("mongoose");

/*
=====================================================
LEDGER ENTRY MODEL
=====================================================

ACCOUNTING RULES

1. Each user has one wallet.
2. The wallet's base currency is USD.
3. New wallet ledger entries record USD amounts.
4. Display currency does not affect ledger entries.
5. Original deposit/withdrawal currency and FX details
   can be preserved in metadata.
6. Ledger entries are append-only.
=====================================================
*/

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

    The amount is denominated in the wallet's USD
    accounting currency.
    =================================================
    */

    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      validate: {
        validator(value) {
          return (
            value &&
            Number.isFinite(Number(value.toString())) &&
            Number(value.toString()) > 0
          );
        },
        message: "Ledger amount must be greater than zero.",
      },
    },

    /*
    =================================================
    CURRENCY
    =================================================

    All new wallet ledger entries must use USD.

    Historical entries with other currencies can still
    be read from the database. This restriction applies
    to new validated writes.
    =================================================
    */

    currency: {
      type: String,
      enum: {
        values: ["USD"],
        message: "Wallet ledger entries must use USD.",
      },
      default: "USD",
      required: true,
      uppercase: true,
      trim: true,
    },

    /*
    =================================================
    BALANCE AFTER TRANSACTION
    =================================================

    The resulting wallet balance after this entry,
    denominated in USD.
    =================================================
    */

    balanceAfter: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      validate: {
        validator(value) {
          return (
            value &&
            Number.isFinite(Number(value.toString())) &&
            Number(value.toString()) >= 0
          );
        },
        message: "Balance after transaction cannot be negative.",
      },
    },

    /*
    =================================================
    REFERENCE
    =================================================

    Each non-null reference must be unique.
    Generate a distinct reference for every ledger entry.
    =================================================
    */

    reference: {
      type: String,
      trim: true,
      default: null,
      unique: true,
      sparse: true,
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

    Examples:
    {
      originalCurrency: "NGN",
      originalAmount: "150000",
      exchangeRate: "1500",
      conversionFee: "0",
      depositReference: "DEP-...",
      rateProvider: "provider-name",
      rateUpdatedAt: Date
    }

    Metadata explains the source transaction. It does
    not change the currency of the ledger amount.
    =================================================
    */

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /*
    =================================================
    IMMUTABLE FLAG
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

/*
=====================================================
BLOCK DOCUMENT UPDATES
=====================================================
*/

ledgerEntrySchema.pre("save", function (next) {
  if (!this.isNew) {
    return next(
      new Error("Ledger entries are immutable and cannot be modified."),
    );
  }
});

/*
=====================================================
BLOCK QUERY UPDATES
=====================================================
*/

ledgerEntrySchema.pre(
  [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
  ],
  function (next) {
    return next(
      new Error("Ledger entries are immutable and cannot be modified."),
    );
  },
);

/*
=====================================================
BLOCK QUERY DELETIONS
=====================================================
*/

ledgerEntrySchema.pre(
  [
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
    "findOneAndRemove",
  ],
  function (next) {
    return next(
      new Error("Ledger entries are immutable and cannot be deleted."),
    );
  },
);

/*
=====================================================
BLOCK DOCUMENT DELETIONS
=====================================================
*/

ledgerEntrySchema.pre(
  "deleteOne",
  { document: true, query: false },
  function (next) {
    return next(
      new Error("Ledger entries are immutable and cannot be deleted."),
    );
  },
);

module.exports = mongoose.model("LedgerEntry", ledgerEntrySchema);