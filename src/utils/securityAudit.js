const SecurityAuditLog = require("../models/SecurityAuditLogModel");

const createSecurityAuditLog = async ({
  userId = null,
  event,
  description = null,
  req = null,
  metadata = {},
}) => {
  try {
    await SecurityAuditLog.create({
      user: userId,

      event,

      description,

      ipAddress: req ? req.ip || req.headers["x-forwarded-for"] || null : null,

      userAgent: req ? req.get("user-agent") || null : null,

      metadata,
    });
  } catch (error) {
    // Audit logging should never crash authentication.
    console.error("Security audit logging failed:", error);
  }
};

module.exports = {
  createSecurityAuditLog,
};
