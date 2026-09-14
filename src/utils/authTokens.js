const crypto = require("crypto");

// =========================================================
// REFRESH TOKEN
// =========================================================

const generateRefreshToken = () => {
  return crypto.randomBytes(64).toString("hex");
};

const hashRefreshToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

// =========================================================
// CSRF TOKEN
// =========================================================

const generateCsrfToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

const hashCsrfToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

// =========================================================
// REFRESH TOKEN EXPIRATION
// =========================================================

const getRefreshTokenExpiration = () => {
  const days = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 30);

  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
};

module.exports = {
  generateRefreshToken,
  hashRefreshToken,
  generateCsrfToken,
  hashCsrfToken,
  getRefreshTokenExpiration,
};
