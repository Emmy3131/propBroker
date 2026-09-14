const crypto = require("crypto");

const Session = require("../models/SessionModel");

const AppError = require("../utils/AppError");

const { hashRefreshToken, hashCsrfToken } = require("../utils/authTokens");

const protectCsrf = async (req, res, next) => {
  try {
    // =====================================================
    // ONLY PROTECT STATE-CHANGING REQUESTS
    // =====================================================

    const protectedMethods = ["POST", "PATCH", "PUT", "DELETE"];

    if (!protectedMethods.includes(req.method)) {
      return next();
    }

    // =====================================================
    // GET REFRESH TOKEN
    // =====================================================

    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      return next(new AppError("Authentication session is required", 401));
    }

    // =====================================================
    // GET CSRF TOKEN FROM HEADER
    // =====================================================

    const csrfToken = req.get("X-CSRF-Token");

    if (!csrfToken) {
      return next(new AppError("CSRF token is required", 403));
    }

    // =====================================================
    // HASH REFRESH TOKEN
    // =====================================================

    const refreshTokenHash = hashRefreshToken(refreshToken);

    // =====================================================
    // FIND SESSION
    // =====================================================

    const session = await Session.findOne({
      refreshTokenHash,

      revoked: false,

      expiresAt: {
        $gt: new Date(),
      },
    }).select("+refreshTokenHash +csrfTokenHash");

    if (!session) {
      return next(
        new AppError("Invalid or expired authentication session", 401),
      );
    }

    // =====================================================
    // HASH CSRF TOKEN
    // =====================================================

    const csrfTokenHash = hashCsrfToken(csrfToken);

    // =====================================================
    // SAFE COMPARISON
    // =====================================================

    const storedHashBuffer = Buffer.from(session.csrfTokenHash, "utf8");

    const receivedHashBuffer = Buffer.from(csrfTokenHash, "utf8");

    if (storedHashBuffer.length !== receivedHashBuffer.length) {
      return next(new AppError("Invalid CSRF token", 403));
    }

    const valid = crypto.timingSafeEqual(storedHashBuffer, receivedHashBuffer);

    if (!valid) {
      return next(new AppError("Invalid CSRF token", 403));
    }

    // =====================================================
    // CSRF VALID
    // =====================================================

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = protectCsrf;
