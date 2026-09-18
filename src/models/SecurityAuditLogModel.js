const mongoose = require("mongoose");

const securityAuditLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    event: {
      type: String,
      required: true,
      enum: [
        "LOGIN_SUCCESS",
        "LOGIN_FAILED",
        "ACCOUNT_LOCKED",

        "EMAIL_VERIFIED",
        "PASSWORD_CHANGED",
        "PASSWORD_RESET",

        "2FA_ENABLED",
        "2FA_DISABLED",
        "2FA_SUCCESS",
        "2FA_FAILED",
        "BACKUP_CODE_USED",

        "SESSION_CREATED",
        "SESSION_REVOKED",
        "LOGOUT",
        "LOGOUT_ALL",

        "SUSPICIOUS_LOGIN",

        "KYC_SUBMITTED", 
        "KYC_APPROVED", 
        "KYC_REJECTED", 
        "KYC_DOCUMENT_ACCESSED"
      ],
      index: true,
    },

    description: {
      type: String,
      default: null,
    },

    ipAddress: {
      type: String,
      default: null,
    },

    userAgent: {
      type: String,
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

// Useful for security investigation
securityAuditLogSchema.index({
  user: 1,
  createdAt: -1,
});

securityAuditLogSchema.index({
  event: 1,
  createdAt: -1,
});

module.exports = mongoose.model("SecurityAuditLog", securityAuditLogSchema);
