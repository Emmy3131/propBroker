const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    // =====================================================
    // USER
    // =====================================================

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // =====================================================
    // REFRESH TOKEN HASH
    // =====================================================

    refreshTokenHash: {
      type: String,
      required: true,
      select: false,
    },

    // =====================================================
    // CSRF TOKEN HASH
    // =====================================================

    csrfTokenHash: {
      type: String,
      required: true,
      select: false,
    },

    // =====================================================
    // SESSION EXPIRATION
    // =====================================================

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    // =====================================================
    // SESSION REVOCATION
    // =====================================================

    revoked: {
      type: Boolean,
      default: false,
      index: true,
    },

    revokedAt: {
      type: Date,
      default: null,
    },

    // =====================================================
    // SESSION METADATA
    // =====================================================

    userAgent: {
      type: String,
      default: null,
    },

    ipAddress: {
      type: String,
      default: null,
    },

    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

// =========================================================
// TTL INDEX
// Automatically deletes sessions after expiresAt
// =========================================================

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// =========================================================
// ACTIVE SESSION INDEX
// =========================================================

sessionSchema.index({
  user: 1,
  revoked: 1,
});

// =========================================================
// MODEL
// =========================================================

module.exports = mongoose.model("Session", sessionSchema);
