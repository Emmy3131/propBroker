const mongoose = require("mongoose");

const idempotencyKeySchema = new mongoose.Schema(
  {
    /*
    =================================================
    OWNER
    =================================================
    */

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    /*
    =================================================
    IDEMPOTENCY KEY
    =================================================

    Example:

    payment-provider-event-12345
    */

    key: {
      type: String,
      required: true,
      trim: true,
    },

    /*
    =================================================
    OPERATION
    =================================================

    Example:

    DEPOSIT
    WITHDRAWAL
    TRANSFER
    */

    operation: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    /*
    =================================================
    STATUS
    =================================================
    */

    status: {
      type: String,
      enum: ["processing", "completed", "failed"],
      default: "processing",
    },

    /*
    =================================================
    STORED RESULT
    =================================================

    Allows a repeated request to receive the
    original result instead of processing again.
    */

    response: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    /*
    =================================================
    RESOURCE REFERENCE
    =================================================

    Example:

    wallet ID
    deposit ID
    withdrawal ID
    */

    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    /*
    =================================================
    EXPIRATION
    =================================================
    */

    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

/*
=====================================================
PREVENT DUPLICATE IDEMPOTENCY KEYS
=====================================================
*/

idempotencyKeySchema.index(
  {
    user: 1,
    key: 1,
    operation: 1,
  },
  {
    unique: true,
  }
);

/*
=====================================================
AUTOMATIC CLEANUP
=====================================================
*/

idempotencyKeySchema.index(
  {
    expiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
  }
);

module.exports = mongoose.model(
  "IdempotencyKey",
  idempotencyKeySchema
);