const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema(
  {
    /*
    =====================================================
    USER
    =====================================================
    */

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /*
    =====================================================
    WALLET
    =====================================================
    */

    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
      index: true,
    },

    /*
    =====================================================
    WITHDRAWAL REFERENCE
    =====================================================
    */

    reference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    /*
    =====================================================
    PAYMENT PROVIDER
    =====================================================
    */

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
      index: true,
    },

    providerTransactionId: {
      type: String,
      trim: true,
      default: null,
    },

    /*
    =====================================================
    AMOUNT
    =====================================================
    */

    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    currency: {
      type: String,
      enum: ["USD", "NGN", "CAD", "EUR"],
      required: true,
      uppercase: true,
    },

    /*
    =====================================================
    STATUS
    =====================================================
    */

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

    /*
    =====================================================
    DESTINATION / BANK DETAILS
    =====================================================

    Store only the information required to process
    the withdrawal.
    */

    payoutMethod: {
      type: String,
      enum: ["bank_transfer", "other"],
      default: "bank_transfer",
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

    /*
    =====================================================
    ADMIN REVIEW
    =====================================================
    */

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

    /*
    =====================================================
    REJECTION
    =====================================================
    */

    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    /*
    =====================================================
    FAILURE
    =====================================================
    */

    failureReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    /*
    =====================================================
    PROCESSING
    =====================================================
    */

    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    processedAt: {
      type: Date,
      default: null,
    },

    /*
    =====================================================
    COMPLETION
    =====================================================
    */

    completedAt: {
      type: Date,
      default: null,
    },

    /*
    =====================================================
    LEDGER
    =====================================================
    */

    ledgerEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LedgerEntry",
      default: null,
    },

    /*
    =====================================================
    PROVIDER RESPONSE
    =====================================================

    Keep this private from normal API responses.
    */

    providerData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
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

withdrawalSchema.index({
  user: 1,
  createdAt: -1,
});

withdrawalSchema.index({
  status: 1,
  createdAt: -1,
});

withdrawalSchema.index({
  wallet: 1,
  createdAt: -1,
});

withdrawalSchema.index({
  currency: 1,
  status: 1,
  createdAt: -1,
});

/*
=====================================================
PROVIDER TRANSACTION UNIQUENESS
=====================================================
*/

withdrawalSchema.index(
  {
    provider: 1,
    providerTransactionId: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      providerTransactionId: {
        $type: "string",
      },
    },
  },
);

module.exports = mongoose.model("Withdrawal", withdrawalSchema);
