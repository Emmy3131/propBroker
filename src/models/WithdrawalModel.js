const mongoose = require("mongoose");

const SUPPORTED_CURRENCIES = ["USD", "NGN", "CAD", "EUR"];

const withdrawalSchema = new mongoose.Schema(
  {
    // USER
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // SINGLE USD-BASED WALLET
    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
      index: true,
    },

    // UNIQUE WITHDRAWAL REFERENCE
    reference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // PAYOUT PROVIDER
    provider: {
      type: String,
      enum: ["paystack", "flutterwave", "manual"],
      default: "manual",
      lowercase: true,
      trim: true,
      index: true,
    },

    providerReference: {
      type: String,
      trim: true,
      default: null,
    },

    providerTransactionId: {
      type: String,
      trim: true,
      default: null,
    },

    // AMOUNT THE USER REQUESTED TO RECEIVE
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      validate: {
        validator(value) {
          const amount = Number(value.toString());
          return Number.isFinite(amount) && amount > 0;
        },
        message: "Withdrawal amount must be greater than zero.",
      },
    },

    currency: {
      type: String,
      enum: SUPPORTED_CURRENCIES,
      required: true,
      uppercase: true,
      trim: true,
    },

    // AMOUNT RESERVED FROM THE USD WALLET
    walletAmountUsd: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      validate: {
        validator(value) {
          const amount = Number(value.toString());
          return Number.isFinite(amount) && amount > 0;
        },
        message: "USD wallet reservation must be greater than zero.",
      },
    },

    walletCurrency: {
      type: String,
      enum: ["USD"],
      default: "USD",
      required: true,
    },

    // FX SNAPSHOT
    exchangeRate: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      validate: {
        validator(value) {
          const rate = Number(value.toString());
          return Number.isFinite(rate) && rate > 0;
        },
        message: "Exchange rate must be greater than zero.",
      },
    },

    exchangeRateUpdatedAt: {
      type: Date,
      default: null,
    },

    exchangeRateProvider: {
      type: String,
      trim: true,
      default: null,
    },

    // FEES, IF YOUR PAYOUT PROCESSOR CHARGES THEM
    feeAmount: {
      type: mongoose.Schema.Types.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString("0"),
    },

    feeCurrency: {
      type: String,
      enum: SUPPORTED_CURRENCIES,
      default: "USD",
    },

    // RESERVATION LIFECYCLE
    reservationStatus: {
      type: String,
      enum: ["held", "released", "consumed"],
      default: "held",
      required: true,
      index: true,
    },

    // WITHDRAWAL STATUS
    status: {
      type: String,
      enum: [
        "pending",
        "under_review",
        "approved",
        "processing",
        "successful",
        "rejected",
        "failed",
        "cancelled",
      ],
      default: "pending",
      index: true,
    },

    // PAYOUT DESTINATION
    payoutMethod: {
      type: String,
      enum: ["bank_transfer", "other"],
      default: "bank_transfer",
    },

    walletAmountUsd: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      min: 0,
    },

    bankDetails: {
      bankName: {
        type: String,
        trim: true,
        maxlength: 200,
        default: null,
      },
      bankCode: {
        type: String,
        trim: true,
        maxlength: 50,
        default: null,
      },
      accountName: {
        type: String,
        trim: true,
        maxlength: 200,
        default: null,
      },
      accountNumber: {
        type: String,
        trim: true,
        maxlength: 100,
        default: null,
      },
    },

    // ADMIN REVIEW
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewNote: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
    },

    // REJECTION
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    // FAILURE
    failureReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    // PROCESSING
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },

    // COMPLETION
    completedAt: {
      type: Date,
      default: null,
    },

    // FINAL ACCOUNTING ENTRY
    ledgerEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LedgerEntry",
      default: null,
    },

    // PRIVATE PROVIDER RESPONSE
    providerData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
  },
);

// QUERY INDEXES
withdrawalSchema.index({ user: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1, createdAt: -1 });
withdrawalSchema.index({ wallet: 1, createdAt: -1 });
withdrawalSchema.index({ currency: 1, status: 1, createdAt: -1 });

// Prevent duplicate provider transaction IDs.
// Null/missing IDs are not subject to this unique index.
withdrawalSchema.index(
  { provider: 1, providerTransactionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      providerTransactionId: { $type: "string" },
    },
  },
);

module.exports = mongoose.model("Withdrawal", withdrawalSchema);
