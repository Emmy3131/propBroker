const crypto = require("crypto");

// =========================================================
// REFRESH TOKEN
// =========================================================

const generateRefreshToken = () => {
  return crypto.randomBytes(64).toString("hex");
};

// =========================================================
// HASH REFRESH TOKEN
// =========================================================

const hashRefreshToken = (token) => {
  if (!token) {
    throw new Error("Refresh token is required for hashing");
  }

  return crypto.createHash("sha256").update(token).digest("hex");
};

// =========================================================
// CSRF TOKEN
// =========================================================

const generateCsrfToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

// =========================================================
// HASH CSRF TOKEN
// =========================================================

const hashCsrfToken = (token) => {
  if (!token) {
    throw new Error("CSRF token is required for hashing");
  }

  return crypto.createHash("sha256").update(token).digest("hex");
};

// =========================================================
// REFRESH TOKEN EXPIRATION
// =========================================================

const getRefreshTokenExpiration = () => {
  const days = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 30);

  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("REFRESH_TOKEN_EXPIRES_DAYS must be a positive number");
  }

  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
};

// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  generateRefreshToken,
  hashRefreshToken,
  generateCsrfToken,
  hashCsrfToken,
  getRefreshTokenExpiration,
};
