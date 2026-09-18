const mongoose = require("mongoose");

const ledgerEntrySchema = new mongoose.Schema(
  {
    /*
     * Wallet this transaction belongs to.
     */
    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
      index: true,
    },

    /*
     * User who owns the wallet.
     *
     * Keeping this reference makes querying easier and
     * allows us to audit transactions even if wallet
     * relationships change later.
     */
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /*
     * Financial transaction type.
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
     * Direction of the transaction from the wallet's
     * perspective.
     */
    direction: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
      required: true,
    },

    /*
     * Amount of this individual ledger entry.
     *
     * Always store a positive amount here.
     * direction determines whether it increases or
     * decreases the wallet.
     */
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    currency: {
      type: String,
      enum: ["USD", "NGN"],
      required: true,
      uppercase: true,
    },

    /*
     * Wallet balance after this transaction.
     *
     * This gives us an audit trail showing what the
     * balance was immediately after each transaction.
     */
    balanceAfter: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    /*
     * Optional reference to an external/internal transaction.
     *
     * Examples:
     *
     * PAYSTACK-123456
     * withdrawal MongoDB ID
     * trade/order ID
     */
    reference: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /*
     * Ledger entries should never be edited or deleted
     * after creation.
     */
    immutable: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

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

module.exports = mongoose.model(
  "LedgerEntry",
  ledgerEntrySchema
);
