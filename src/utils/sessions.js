const Session = require("../models/SessionModel");

const {
  generateRefreshToken,
  hashRefreshToken,
  generateCsrfToken,
  hashCsrfToken,
  getRefreshTokenExpiration,
} = require("./authTokens");

const createSession = async (user, req) => {
  const refreshToken = generateRefreshToken();

  const refreshTokenHash = hashRefreshToken(refreshToken);

  const csrfToken = generateCsrfToken();

  const csrfTokenHash = hashCsrfToken(csrfToken);

  const expiresAt = getRefreshTokenExpiration();

  const session = await Session.create({
    user: user._id,

    refreshTokenHash,

    csrfTokenHash,

    expiresAt,

    userAgent: req.get("user-agent") || null,

    ipAddress: req.ip || req.headers["x-forwarded-for"] || null,

    lastUsedAt: new Date(),
  });

  return {
    refreshToken,
    csrfToken,
    session,
  };
};

module.exports = {
  createSession,
};
