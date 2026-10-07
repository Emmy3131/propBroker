const mongoose = require("mongoose");

const paymentMethodSchema = new mongoose.Schema(
  {
    /*
    =====================================================
    BASIC INFORMATION
    =====================================================
    */

    name: {
      type: String,
      required: [true, "Payment method name is required."],
      trim: true,
      maxlength: 100,
    },

    type: {
      type: String,
      required: [true, "Payment method type is required."],
      enum: ["bank_transfer", "crypto", "mobile_money", "other"],
      lowercase: true,
      trim: true,
      index: true,
    },

    currency: {
      type: String,
      required: [true, "Currency is required."],
      enum: ["USD", "NGN", "CAD", "EUR"],
      uppercase: true,
      trim: true,
      index: true,
    },

    /*
    =====================================================
    PAYMENT ACCOUNT INFORMATION
    =====================================================

    These fields are optional because different payment
    methods require different information.
    */

    bankName: {
      type: String,
      trim: true,
      default: null,
    },

    accountName: {
      type: String,
      trim: true,
      default: null,
    },

    accountNumber: {
      type: String,
      trim: true,
      default: null,
    },

    routingNumber: {
      type: String,
      trim: true,
      default: null,
    },

    iban: {
      type: String,
      trim: true,
      default: null,
    },

    swiftCode: {
      type: String,
      trim: true,
      default: null,
    },

    /*
    =====================================================
    CRYPTO INFORMATION
    =====================================================
    */

    network: {
      type: String,
      trim: true,
      default: null,
    },

    walletAddress: {
      type: String,
      trim: true,
      default: null,
    },

    /*
    =====================================================
    GENERAL INSTRUCTIONS
    =====================================================
    */

    instructions: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    /*
    =====================================================
    STATUS
    =====================================================
    */

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },

    /*
    =====================================================
    DISPLAY ORDER
    =====================================================
    */

    displayOrder: {
      type: Number,
      default: 0,
    },

    /*
    =====================================================
    CREATED / UPDATED BY
    =====================================================
    */

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

paymentMethodSchema.index({
  currency: 1,
  status: 1,
  displayOrder: 1,
});

module.exports = mongoose.model("PaymentMethod", paymentMethodSchema);
