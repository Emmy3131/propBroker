const rateLimit = require("express-rate-limit");

// =========================================================
// LOGIN RATE LIMIT
// =========================================================

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  max: 10,

  standardHeaders: true,

  legacyHeaders: false,

  message: {
    status: "fail",
    message: "Too many login attempts. Please try again later.",
  },
});

module.exports = {
  loginLimiter,
};
