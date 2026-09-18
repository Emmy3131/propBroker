const crypto = require("crypto");

const User = require("../models/UserModel");
const Session = require("../models/SessionModel");

const { createSession } = require("../utils/sessions");

const { createSecurityAuditLog } = require("../utils/securityAudit");

const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");

const {
  generateRefreshToken,
  hashRefreshToken,
  generateCsrfToken,
  hashCsrfToken,
} = require("../utils/authTokens");

const { sendVerificationEmail } = require("../utils/email");
const {
  getRefreshTokenCookieOptions,
} = require("../config/cookies");

const TwoFactorChallenge = require("../models/TwiFactorChallengeModel");

// =========================================================
// TWO-FACTOR HELPER
// =========================================================

const createTwoFactorChallenge = async (user, req) => {
  const rawChallenge = crypto.randomBytes(32).toString("hex");

  const challengeHash = crypto
    .createHash("sha256")
    .update(rawChallenge)
    .digest("hex");

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await TwoFactorChallenge.create({
    user: user._id,
    challengeHash,
    expiresAt,
    ipAddress:
      req.ip ||
      req.headers["x-forwarded-for"] ||
      null,
    userAgent: req.get("user-agent") || null,
  });

  return rawChallenge;
};

// =========================================================
// SIGN UP
// =========================================================

exports.signup = catchAsync(async (req, res, next) => {
  const {
    name,
    email,
    password,
    phone,
    country,
    referralCode,
  } = req.body || {};

  // -------------------------------------------------------
  // VALIDATE REQUIRED FIELDS
  // -------------------------------------------------------

  if (!name || !email || !password) {
    return next(
      new AppError(
        "Name, email and password are required",
        400
      )
    );
  }

  const normalizedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  // -------------------------------------------------------
  // VALIDATE PASSWORD
  // -------------------------------------------------------

  if (password.length < 8) {
    return next(
      new AppError(
        "Password must be at least 8 characters",
        400
      )
    );
  }

  // -------------------------------------------------------
  // CHECK EXISTING USER
  // -------------------------------------------------------

  const existingUser = await User.findOne({
    email: normalizedEmail,
  });

  if (existingUser) {
    return next(
      new AppError(
        "An account with this email already exists",
        409
      )
    );
  }

  // -------------------------------------------------------
  // GENERATE UNIQUE REFERRAL CODE
  // -------------------------------------------------------

  let generatedReferralCode;

  while (!generatedReferralCode) {
    const candidate = crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase();

    const existingCode = await User.findOne({
      referralCode: candidate,
    });

    if (!existingCode) {
      generatedReferralCode = candidate;
    }
  }

  // -------------------------------------------------------
  // FIND REFERRER
  // -------------------------------------------------------

  let referredBy = null;

  if (referralCode) {
    const normalizedReferralCode = referralCode
      .trim()
      .toUpperCase();

    const referrer = await User.findOne({
      referralCode: normalizedReferralCode,
    });

    if (referrer) {
      referredBy = referrer._id;
    }
  }

  // -------------------------------------------------------
  // CREATE USER
  // -------------------------------------------------------

  const user = new User({
    name: normalizedName,
    email: normalizedEmail,
    password,
    phone,
    country,
    referralCode: generatedReferralCode,
    referredBy,
    status: "pending",
    emailVerified: false,
  });

  // -------------------------------------------------------
  // CREATE EMAIL VERIFICATION TOKEN
  // -------------------------------------------------------

  const verificationToken =
    user.createEmailVerificationToken();

  // -------------------------------------------------------
  // SAVE USER
  // -------------------------------------------------------

  await user.save();

  // -------------------------------------------------------
  // SEND VERIFICATION EMAIL
  // -------------------------------------------------------

  try {
    await sendVerificationEmail({
      name: user.name,
      email: user.email,
      verificationToken,
    });
  } catch (error) {
    console.error(
      "Verification email failed:",
      error
    );

    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;

    await user.save({
      validateBeforeSave: false,
    });

    return res.status(201).json({
      status: "success",
      message:
        "Account created, but the verification email could not be sent. Please request another verification email.",
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          status: user.status,
          emailVerified: user.emailVerified,
        },
        emailSent: false,
      },
    });
  }

  const response = {
    status: "success",

    message:
      "Account created. Please verify your email address.",

    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        country: user.country,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        status: user.status,
        emailVerified: user.emailVerified,
      },

      emailSent: true,
    },
  };

  // -------------------------------------------------------
  // DEVELOPMENT ONLY
  // -------------------------------------------------------

  if (process.env.NODE_ENV === "development") {
    response.verificationToken = verificationToken;
  }

  res.status(201).json(response);
});

// =========================================================
// VERIFY EMAIL
// =========================================================

exports.verifyEmail = catchAsync(async (req, res, next) => {
  const { token } = req.params;

  if (!token) {
    return next(
      new AppError(
        "Verification token is required",
        400
      )
    );
  }

  // -------------------------------------------------------
  // HASH TOKEN
  // -------------------------------------------------------

  const hashedToken = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  // -------------------------------------------------------
  // FIND USER
  // -------------------------------------------------------

  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: {
      $gt: Date.now(),
    },
  }).select(
    "+emailVerificationToken +emailVerificationExpires"
  );

  if (!user) {
    return next(
      new AppError(
        "Verification token is invalid or has expired",
        400
      )
    );
  }

  // -------------------------------------------------------
  // VERIFY ACCOUNT
  // -------------------------------------------------------

  user.emailVerified = true;
  user.status = "active";
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;

  await user.save();

  // -------------------------------------------------------
  // SECURITY AUDIT
  // -------------------------------------------------------

  await createSecurityAuditLog({
    userId: user._id,
    event: "EMAIL_VERIFIED",
    description:
      "User email address was successfully verified.",
    req,
  });

  res.status(200).json({
    status: "success",
    message:
      "Email verified successfully. Your account is now active.",
  });
});

// =========================================================
// RESEND VERIFICATION EMAIL
// =========================================================

exports.resendVerification = catchAsync(
  async (req, res, next) => {
    const { email } = req.body;

    if (!email) {
      return next(
        new AppError(
          "Please provide your email address",
          400
        )
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: normalizedEmail,
    });

    const genericMessage =
      "If an account with that email exists and is not verified, a new verification email has been sent.";

    // -----------------------------------------------------
    // ACCOUNT DOES NOT EXIST
    // -----------------------------------------------------

    if (!user) {
      return res.status(200).json({
        status: "success",
        message: genericMessage,
      });
    }

    // -----------------------------------------------------
    // ALREADY VERIFIED
    // -----------------------------------------------------

    if (user.emailVerified) {
      return res.status(200).json({
        status: "success",
        message: genericMessage,
      });
    }

    // -----------------------------------------------------
    // CREATE NEW TOKEN
    // -----------------------------------------------------

    const verificationToken =
      user.createEmailVerificationToken();

    await user.save({
      validateBeforeSave: false,
    });

    // -----------------------------------------------------
    // SEND EMAIL
    // -----------------------------------------------------

    try {
      await sendVerificationEmail({
        name: user.name,
        email: user.email,
        verificationToken,
      });
    } catch (error) {
      console.error(
        "Resend verification email failed:",
        error
      );

      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;

      await user.save({
        validateBeforeSave: false,
      });

      return next(
        new AppError(
          "Unable to send verification email. Please try again later.",
          500
        )
      );
    }

    res.status(200).json({
      status: "success",
      message: genericMessage,
    });
  }
);

// =========================================================
// LOGIN
// =========================================================

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body || {};

  // -------------------------------------------------------
  // VALIDATE INPUT
  // -------------------------------------------------------

  if (!email || !password) {
    return next(
      new AppError(
        "Please provide email and password.",
        400
      )
    );
  }

  const normalizedEmail = email.trim().toLowerCase();

  // -------------------------------------------------------
  // FIND USER
  // -------------------------------------------------------

  const user = await User.findOne({
    email: normalizedEmail,
  }).select(
    "+password +failedLoginAttempts +lockUntil"
  );

  // -------------------------------------------------------
  // USER DOES NOT EXIST
  // -------------------------------------------------------

  if (!user) {
    await createSecurityAuditLog({
      event: "LOGIN_FAILED",
      description:
        "Login failed because the account does not exist.",
      req,
      metadata: {
        reason: "user_not_found",
      },
    });

    return next(
      new AppError(
        "Incorrect email or password.",
        401
      )
    );
  }

  // -------------------------------------------------------
  // CHECK ACCOUNT LOCK
  // -------------------------------------------------------

  if (user.isLocked()) {
    await createSecurityAuditLog({
      userId: user._id,
      event: "LOGIN_FAILED",
      description:
        "Login attempt rejected because the account is temporarily locked.",
      req,
      metadata: {
        reason: "account_locked",
      },
    });

    return next(
      new AppError(
        "Your account is temporarily locked. Please try again later.",
        423
      )
    );
  }

  // -------------------------------------------------------
  // CHECK PASSWORD
  // -------------------------------------------------------

  const correctPassword =
    await user.comparePassword(password);

  if (!correctPassword) {
    user.failedLoginAttempts =
      (user.failedLoginAttempts || 0) + 1;

    const failedAttempts =
      user.failedLoginAttempts;

    // -----------------------------------------------------
    // SECURITY AUDIT - FAILED LOGIN
    // -----------------------------------------------------

    await createSecurityAuditLog({
      userId: user._id,
      event: "LOGIN_FAILED",
      description:
        "Login failed because the supplied password was incorrect.",
      req,
      metadata: {
        reason: "invalid_password",
        failedAttempts,
      },
    });

    // -----------------------------------------------------
    // LOCK ACCOUNT AFTER 5 FAILED ATTEMPTS
    // -----------------------------------------------------

    if (user.failedLoginAttempts >= 5) {
      user.lockUntil =
        Date.now() + 15 * 60 * 1000;

      user.failedLoginAttempts = 0;

      await createSecurityAuditLog({
        userId: user._id,
        event: "ACCOUNT_LOCKED",
        description:
          "Account temporarily locked after repeated failed login attempts.",
        req,
        metadata: {
          failedAttempts,
          lockDurationMinutes: 15,
        },
      });
    }

    await user.save({
      validateBeforeSave: false,
    });

    return next(
      new AppError(
        "Incorrect email or password.",
        401
      )
    );
  }

  // -------------------------------------------------------
  // RESET FAILED LOGIN ATTEMPTS
  // -------------------------------------------------------

  if (
    user.failedLoginAttempts ||
    user.lockUntil
  ) {
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;

    await user.save({
      validateBeforeSave: false,
    });
  }

  // -------------------------------------------------------
  // CHECK EMAIL VERIFICATION
  // -------------------------------------------------------

  if (!user.emailVerified) {
    await createSecurityAuditLog({
      userId: user._id,
      event: "LOGIN_FAILED",
      description:
        "Login rejected because the user's email address has not been verified.",
      req,
      metadata: {
        reason: "email_not_verified",
      },
    });

    return next(
      new AppError(
        "Please verify your email address before logging in.",
        403
      )
    );
  }

  // -------------------------------------------------------
  // CHECK ACCOUNT STATUS
  // -------------------------------------------------------

  if (
    ["suspended", "blocked", "closed"].includes(
      user.status
    )
  ) {
    await createSecurityAuditLog({
      userId: user._id,
      event: "LOGIN_FAILED",
      description:
        "Login rejected because the account is not allowed to authenticate.",
      req,
      metadata: {
        reason: "account_status",
        accountStatus: user.status,
      },
    });

    return next(
      new AppError(
        "Your account is not allowed to log in.",
        403
      )
    );
  }

  // -------------------------------------------------------
  // UPDATE LOGIN INFORMATION
  // -------------------------------------------------------

  user.lastLoginAt = new Date();

  user.lastLoginIp =
    req.ip ||
    req.headers["x-forwarded-for"] ||
    null;

  user.lastActiveAt = new Date();

  await user.save({
    validateBeforeSave: false,
  });

  // -------------------------------------------------------
  // TWO-FACTOR AUTHENTICATION
  // -------------------------------------------------------

  if (user.twoFactorEnabled) {
    const challenge =
      await createTwoFactorChallenge(
        user,
        req
      );

    res.status(200).json({
      status: "success",
      message:
        "Password verified. Two-factor authentication is required.",
      requiresTwoFactor: true,
      challenge,
    });

    return;
  }

  // -------------------------------------------------------
  // CREATE SESSION
  // -------------------------------------------------------

  const {
    refreshToken,
    csrfToken,
    session,
  } = await createSession(user, req);

  // -------------------------------------------------------
  // SET REFRESH TOKEN COOKIE
  // -------------------------------------------------------

  res.cookie(
    "refreshToken",
    refreshToken,
    getRefreshTokenCookieOptions()
  );

  // -------------------------------------------------------
  // GENERATE ACCESS TOKEN
  // -------------------------------------------------------

  const accessToken =
    user.generateAccessToken();

  // -------------------------------------------------------
  // SECURITY AUDIT - SUCCESSFUL LOGIN
  // -------------------------------------------------------

  await createSecurityAuditLog({
    userId: user._id,
    event: "LOGIN_SUCCESS",
    description:
      "User successfully logged in.",
    req,
    metadata: {
      twoFactor: false,
      sessionId: session._id,
    },
  });

  // -------------------------------------------------------
  // RESPONSE
  // -------------------------------------------------------

  res.status(200).json({
    status: "success",

    message: "Login successful.",

    accessToken,

    csrfToken,

    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        country: user.country,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified,
        referralCode: user.referralCode,
      },

      sessionId: session._id,
    },
  });
});

// =========================================================
// GET CURRENT USER
// =========================================================

exports.getMe = catchAsync(
  async (req, res, next) => {
    const user = await User.findById(req.user.id);

    if (!user) {
      return next(
        new AppError(
          "User no longer exists",
          404
        )
      );
    }

    res.status(200).json({
      status: "success",

      data: {
        user,
      },
    });
  }
);

// =========================================================
// FORGOT PASSWORD
// =========================================================

exports.forgotPassword = catchAsync(
  async (req, res, next) => {
    const { email } = req.body;

    if (!email) {
      return next(
        new AppError(
          "Please provide your email address",
          400
        )
      );
    }

    const normalizedEmail =
      email.trim().toLowerCase();

    const user = await User.findOne({
      email: normalizedEmail,
    }).select(
      "+passwordResetToken +passwordResetExpires"
    );

    const genericMessage =
      "If an account with that email exists, a password reset link has been sent.";

    // -----------------------------------------------------
    // DO NOT REVEAL WHETHER ACCOUNT EXISTS
    // -----------------------------------------------------

    if (!user) {
      return res.status(200).json({
        status: "success",
        message: genericMessage,
      });
    }

    // -----------------------------------------------------
    // CREATE RESET TOKEN
    // -----------------------------------------------------

    const resetToken =
      user.createPasswordResetToken();

    await user.save({
      validateBeforeSave: false,
    });

    // -----------------------------------------------------
    // AUDIT RESET REQUEST
    // -----------------------------------------------------

    await createSecurityAuditLog({
      userId: user._id,
      event: "PASSWORD_RESET_REQUESTED",
      description:
        "A password reset was requested for the account.",
      req,
    });

    // -----------------------------------------------------
    // TODO:
    // SEND PASSWORD RESET EMAIL HERE
    // -----------------------------------------------------

    const response = {
      status: "success",
      message: genericMessage,
    };

    // -----------------------------------------------------
    // DEVELOPMENT ONLY
    // -----------------------------------------------------

    if (process.env.NODE_ENV === "development") {
      response.resetToken = resetToken;
    }

    res.status(200).json(response);
  }
);

// =========================================================
// RESET PASSWORD
// =========================================================

exports.resetPassword = catchAsync(
  async (req, res, next) => {
    const { token } = req.params;
    const { password } = req.body;

    if (!token) {
      return next(
        new AppError(
          "Password reset token is required",
          400
        )
      );
    }

    if (!password) {
      return next(
        new AppError(
          "Please provide a new password",
          400
        )
      );
    }

    if (password.length < 8) {
      return next(
        new AppError(
          "Password must be at least 8 characters",
          400
        )
      );
    }

    // -----------------------------------------------------
    // HASH RESET TOKEN
    // -----------------------------------------------------

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    // -----------------------------------------------------
    // FIND USER
    // -----------------------------------------------------

    const user = await User.findOne({
      passwordResetToken: hashedToken,

      passwordResetExpires: {
        $gt: Date.now(),
      },
    }).select(
      "+passwordResetToken +passwordResetExpires"
    );

    if (!user) {
      return next(
        new AppError(
          "Password reset token is invalid or has expired",
          400
        )
      );
    }

    // -----------------------------------------------------
    // UPDATE PASSWORD
    // -----------------------------------------------------

    user.password = password;

    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    user.passwordChangedAt = Date.now();

    await user.save();

    // -----------------------------------------------------
    // REVOKE EXISTING SESSIONS
    // -----------------------------------------------------

    const revokedSessions =
      await Session.updateMany(
        {
          user: user._id,
          revoked: false,
        },
        {
          revoked: true,
          revokedAt: new Date(),
        }
      );

    // -----------------------------------------------------
    // SECURITY AUDIT
    // -----------------------------------------------------

    await createSecurityAuditLog({
      userId: user._id,
      event: "PASSWORD_RESET",
      description:
        "User password was successfully reset.",
      req,
      metadata: {
        sessionsRevoked:
          revokedSessions.modifiedCount || 0,
      },
    });

    // -----------------------------------------------------
    // RESPONSE
    // -----------------------------------------------------

    res.status(200).json({
      status: "success",

      message:
        "Password reset successfully. Please log in again.",
    });
  }
);

// =========================================================
// REFRESH ACCESS TOKEN
// =========================================================

exports.refreshAccessToken = catchAsync(
  async (req, res, next) => {
    const refreshToken =
      req.cookies?.refreshToken;

    if (!refreshToken) {
      return next(
        new AppError(
          "Refresh token is required",
          401
        )
      );
    }

    // -----------------------------------------------------
    // HASH REFRESH TOKEN
    // -----------------------------------------------------

    const refreshTokenHash =
      hashRefreshToken(refreshToken);

    // -----------------------------------------------------
    // FIND ACTIVE SESSION
    // -----------------------------------------------------

    const session = await Session.findOne({
      refreshTokenHash,

      revoked: false,

      expiresAt: {
        $gt: new Date(),
      },
    }).select("+refreshTokenHash");

    // -----------------------------------------------------
    // INVALID SESSION
    // -----------------------------------------------------

    if (!session) {
      res.clearCookie(
        "refreshToken",
        getRefreshTokenCookieOptions()
      );

      await createSecurityAuditLog({
        event: "SUSPICIOUS_LOGIN",
        description:
          "An invalid or expired refresh token was presented.",
        req,
        metadata: {
          reason: "invalid_refresh_token",
        },
      });

      return next(
        new AppError(
          "Invalid or expired session",
          401
        )
      );
    }

    // -----------------------------------------------------
    // FIND USER
    // -----------------------------------------------------

    const user = await User.findById(
      session.user
    );

    if (!user) {
      await createSecurityAuditLog({
        event: "SUSPICIOUS_LOGIN",
        description:
          "A refresh token was presented for a user account that no longer exists.",
        req,
        metadata: {
          reason: "user_not_found",
          sessionId: session._id,
        },
      });

      return next(
        new AppError(
          "User no longer exists",
          401
        )
      );
    }

    // -----------------------------------------------------
    // CHECK ACCOUNT STATUS
    // -----------------------------------------------------

    if (
      user.status === "blocked" ||
      user.status === "suspended" ||
      user.status === "closed"
    ) {
      await createSecurityAuditLog({
        userId: user._id,
        event: "SUSPICIOUS_LOGIN",
        description:
          "Authentication was attempted using a session belonging to a restricted account.",
        req,
        metadata: {
          reason: "restricted_account",
          accountStatus: user.status,
          sessionId: session._id,
        },
      });

      return next(
        new AppError(
          "This account cannot be authenticated",
          403
        )
      );
    }

    // -----------------------------------------------------
    // ROTATE REFRESH TOKEN
    // -----------------------------------------------------

    const newRefreshToken =
      generateRefreshToken();

    const newCsrfToken =
      generateCsrfToken();

    session.refreshTokenHash =
      hashRefreshToken(
        newRefreshToken
      );

    session.csrfTokenHash =
      hashCsrfToken(newCsrfToken);

    session.lastUsedAt = new Date();

    await session.save();

    // -----------------------------------------------------
    // SET NEW COOKIE
    // -----------------------------------------------------

    res.cookie(
      "refreshToken",
      newRefreshToken,
      getRefreshTokenCookieOptions()
    );

    // -----------------------------------------------------
    // GENERATE NEW ACCESS TOKEN
    // -----------------------------------------------------

    const accessToken =
      user.generateAccessToken();

    res.status(200).json({
      status: "success",

      accessToken,

      csrfToken: newCsrfToken,
    });
  }
);

// =========================================================
// LOGOUT CURRENT SESSION
// =========================================================

exports.logout = catchAsync(
  async (req, res) => {
    const refreshToken =
      req.cookies?.refreshToken;

    let revokedSession = null;

    if (refreshToken) {
      const refreshTokenHash =
        hashRefreshToken(refreshToken);

      revokedSession =
        await Session.findOneAndUpdate(
          {
            refreshTokenHash,
            revoked: false,
          },
          {
            revoked: true,
            revokedAt: new Date(),
          },
          {
            new: true,
          }
        );
    }

    res.clearCookie(
      "refreshToken",
      getRefreshTokenCookieOptions()
    );

    // -----------------------------------------------------
    // SECURITY AUDIT
    // -----------------------------------------------------

    if (revokedSession) {
      await createSecurityAuditLog({
        userId: revokedSession.user,
        event: "LOGOUT",
        description:
          "User logged out of the current session.",
        req,
        metadata: {
          sessionId: revokedSession._id,
        },
      });

      await createSecurityAuditLog({
        userId: revokedSession.user,
        event: "SESSION_REVOKED",
        description:
          "The current authentication session was revoked.",
        req,
        metadata: {
          sessionId: revokedSession._id,
          reason: "logout",
        },
      });
    }

    res.status(200).json({
      status: "success",
      message: "Logged out successfully",
    });
  }
);

// =========================================================
// LOGOUT ALL SESSIONS
// =========================================================

exports.logoutAllSessions = catchAsync(
  async (req, res) => {
    const result =
      await Session.updateMany(
        {
          user: req.user._id,
          revoked: false,
        },
        {
          revoked: true,
          revokedAt: new Date(),
        }
      );

    res.clearCookie(
      "refreshToken",
      getRefreshTokenCookieOptions()
    );

    // -----------------------------------------------------
    // SECURITY AUDIT
    // -----------------------------------------------------

    await createSecurityAuditLog({
      userId: req.user._id,
      event: "LOGOUT_ALL",
      description:
        "All active authentication sessions were revoked.",
      req,
      metadata: {
        sessionsRevoked:
          result.modifiedCount || 0,
      },
    });

    res.status(200).json({
      status: "success",

      message:
        "All sessions have been logged out successfully",
    });
  }
);

// =========================================================
// CSRF TOKEN
// =========================================================
//
// CSRF token is now generated during session creation
// and refresh. There is no separate /csrf endpoint.
//
// =========================================================
