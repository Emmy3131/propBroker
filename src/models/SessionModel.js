const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
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
    REFRESH TOKEN HASH
    =====================================================
    */

    refreshTokenHash: {
      type: String,
      required: true,
      select: false,
    },

    /*
    =====================================================
    CSRF TOKEN HASH
    =====================================================
    */

    csrfTokenHash: {
      type: String,
      required: true,
      select: false,
    },

    /*
    =====================================================
    SESSION EXPIRATION
    =====================================================
    */

    expiresAt: {
      type: Date,
      required: true,
    },

    /*
    =====================================================
    REVOCATION
    =====================================================
    */

    revoked: {
      type: Boolean,
      default: false,
      index: true,
    },

    revokedAt: {
      type: Date,
      default: null,
    },

    /*
    =====================================================
    DEVICE INFORMATION
    =====================================================
    */

    userAgent: {
      type: String,
      default: null,
    },

    ipAddress: {
      type: String,
      default: null,
    },

    /*
    =====================================================
    SESSION ACTIVITY
    =====================================================
    */

    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

/*
=====================================================
TTL INDEX

MongoDB automatically removes the session when
expiresAt is reached.

expireAfterSeconds: 0 means:
delete when expiresAt <= current time.
=====================================================
*/

sessionSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: 0,
  }
);

module.exports = mongoose.model("Session", sessionSchema);