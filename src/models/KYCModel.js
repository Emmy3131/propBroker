const mongoose = require("mongoose");

const kycSchema = new mongoose.Schema(
  {
    // =====================================================
    // USER
    // =====================================================

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // =====================================================
    // KYC STATUS
    // =====================================================

    status: {
      type: String,
      enum: [
        "not_started",
        "pending",
        "under_review",
        "verified",
        "rejected",
      ],
      default: "not_started",
      index: true,
    },

    // =====================================================
    // PERSONAL INFORMATION
    // =====================================================

    firstName: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    lastName: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    dateOfBirth: {
      type: Date,
    },

    country: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    address: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    city: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    state: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    postalCode: {
      type: String,
      trim: true,
      maxlength: 30,
    },

    // =====================================================
    // IDENTITY DOCUMENT
    // =====================================================

    identityDocumentType: {
      type: String,
      enum: [
        "passport",
        "national_id",
        "drivers_license",
        "voters_card",
      ],
    },

    identityDocumentNumber: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    // =====================================================
    // DOCUMENT REFERENCES
    // =====================================================
    //
    // Do NOT store document files as base64 in MongoDB.
    // Store secure storage references instead.
    //

    documentFront: {
      storageKey: {
        type: String,
        default: null,
      },

      url: {
        type: String,
        default: null,
      },
    },

    documentBack: {
      storageKey: {
        type: String,
        default: null,
      },

      url: {
        type: String,
        default: null,
      },
    },

    selfie: {
      storageKey: {
        type: String,
        default: null,
      },

      url: {
        type: String,
        default: null,
      },
    },

    // =====================================================
    // REVIEW INFORMATION
    // =====================================================

    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    reviewNote: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    // =====================================================
    // TIMESTAMPS
    // =====================================================

    submittedAt: {
      type: Date,
      default: null,
    },

    verifiedAt: {
      type: Date,
      default: null,
    },

    rejectedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// =========================================================
// INDEXES
// =========================================================

kycSchema.index({
  status: 1,
  createdAt: -1,
});

kycSchema.index({
  user: 1,
  status: 1,
});

// =========================================================
// MODEL
// =========================================================

module.exports = mongoose.model("KYC", kycSchema);