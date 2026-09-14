const crypto = require("crypto");

const User = require("../models/UserModel");
const Session = require("../models/SessionModel");
const { createSession } = require("./../utils/sessions");
const { createSecurityAuditLog } = require("../utils/securityAudit");

const catchAsync = require("./../utils/catchAsync");
const AppError = require("./../utils/appError");

const {
  generateRefreshToken,
  hashRefreshToken,
  generateCsrfToken,
  hashCsrfToken,
  getRefreshTokenExpiration,
} = require("../utils/authTokens");

const { sendVerificationEmail } = require("../utils/email");
const { getRefreshTokenCookieOptions } = require("../config/cookies");
const TwoFactorChallenge = require("./../models/TwiFactorChallengeModel");

// =========================================================
// CREATE SESSION
// =========================================================

//Two Factore Helper.
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

    ipAddress: req.ip || req.headers["x-forwarded-for"] || null,

    userAgent: req.get("user-agent") || null,
  });

  return rawChallenge;
};

// =========================================================
// SIGN UP
// =========================================================

exports.signup = catchAsync(async (req, res, next) => {
  const { name, email, password, phone, country, referralCode } = req.body;

  // -------------------------------------------------------
  // VALIDATE REQUIRED FIELDS
  // -------------------------------------------------------

  if (!name || !email || !password) {
    return next(new AppError("Name, email and password are required", 400));
  }

  // -------------------------------------------------------
  // NORMALIZE EMAIL
  // -------------------------------------------------------

  const normalizedEmail = email.trim().toLowerCase();

  // -------------------------------------------------------
  // CHECK EXISTING USER
  // -------------------------------------------------------

  const existingUser = await User.findOne({
    email: normalizedEmail,
  });

  if (existingUser) {
    return next(new AppError("An account with this email already exists", 409));
  }

  // -------------------------------------------------------
  // PASSWORD VALIDATION
  // -------------------------------------------------------

  if (password.length < 8) {
    return next(new AppError("Password must be at least 8 characters", 400));
  }

  // -------------------------------------------------------
  // GENERATE UNIQUE REFERRAL CODE
  // -------------------------------------------------------

  let generatedReferralCode;

  do {
    generatedReferralCode = crypto.randomBytes(4).toString("hex").toUpperCase();

    const existingCode = await User.findOne({
      referralCode: generatedReferralCode,
    });

    if (!existingCode) {
      break;
    }
  } while (true);

  // -------------------------------------------------------
  // FIND REFERRER
  // -------------------------------------------------------

  let referredBy = null;

  if (referralCode) {
    const referrer = await User.findOne({
      referralCode: referralCode.trim().toUpperCase(),
    });

    if (referrer) {
      referredBy = referrer._id;
    }
  }

  // -------------------------------------------------------
  // CREATE USER
  // -------------------------------------------------------

  const user = new User({
    name,
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
  // CREATE VERIFICATION TOKEN
  // -------------------------------------------------------

  const verificationToken = user.createEmailVerificationToken();

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
    console.error("Verification email failed:", error);

    // Remove token if email could not be sent
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;

    await user.save({
      validateBeforeSave: false,
    });

    return next(
      new AppError(
        "Account created, but verification email could not be sent. Please request another verification email.",
        500,
      ),
    );
  }

  // -------------------------------------------------------
  // RESPONSE
  // -------------------------------------------------------

  const response = {
    status: "success",

    message: "Account created. Please verify your email address.",

    data: {
      user,
    },
  };

  // Development only
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
    return next(new AppError("Verification token is required", 400));
  }

  // -----------------------------------------------------
  // HASH TOKEN
  // -----------------------------------------------------

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  // -----------------------------------------------------
  // FIND USER
  // -----------------------------------------------------

  const user = await User.findOne({
    emailVerificationToken: hashedToken,

    emailVerificationExpires: {
      $gt: Date.now(),
    },
  }).select("+emailVerificationToken +emailVerificationExpires");

  if (!user) {
    return next(
      new AppError("Verification token is invalid or has expired", 400),
    );
  }

  // -----------------------------------------------------
  // VERIFY ACCOUNT
  // -----------------------------------------------------

  user.emailVerified = true;

  user.status = "active";

  user.emailVerificationToken = undefined;

  user.emailVerificationExpires = undefined;

  await user.save();

  res.status(200).json({
    status: "success",

    message: "Email verified successfully. Your account is now active.",
  });
});

// =========================================================
// RESEND VERIFICATION EMAIL
// =========================================================

exports.resendVerification = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return next(new AppError("Please provide your email address", 400));
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

  const verificationToken = user.createEmailVerificationToken();

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
    console.error("Resend verification email failed:", error);

    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;

    await user.save({
      validateBeforeSave: false,
    });

    return next(
      new AppError(
        "Unable to send verification email. Please try again later.",
        500,
      ),
    );
  }

  res.status(200).json({
    status: "success",
    message: genericMessage,
  });
});

// =========================================================
// LOGIN
// =========================================================

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  /*
  =====================================================
  1. VALIDATE INPUT
  =====================================================
  */

  if (!email || !password) {
    return next(new AppError("Please provide your email and password.", 400));
  }

  const normalizedEmail = email.trim().toLowerCase();

  /*
  =====================================================
  2. FIND USER
  =====================================================

  We explicitly select password and lockout fields
  because they are select:false in the schema.
  */

  const user = await User.findOne({
    email: normalizedEmail,
  }).select("+password +failedLoginAttempts +lockUntil");

  /*
  =====================================================
  3. USER DOES NOT EXIST
  =====================================================

  Do not reveal whether the email exists.
  */

  if (!user) {
    return next(new AppError("Invalid email or password.", 401));
  }

  /*
  =====================================================
  4. CHECK ACCOUNT LOCK
  =====================================================
  */

  if (user.isLocked()) {
    const remainingMs = user.lockUntil.getTime() - Date.now();

    const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));

    return next(
      new AppError(
        `Account temporarily locked. Please try again in ${remainingMinutes} minute(s).`,
        423,
      ),
    );
  }

  /*
  =====================================================
  5. CHECK PASSWORD
  =====================================================
  */

  const passwordCorrect = await user.comparePassword(password);

  //check if 2FA is enabled and password is correct, then create a 2FA challenge
  if (user.twoFactorEnabled) {
    const challenge = await createTwoFactorChallenge(user, req);

    return res.status(200).json({
      status: "success",

      requiresTwoFactor: true,

      challenge,
    });
  }

  /*
  =====================================================
  6. WRONG PASSWORD
  =====================================================
  */

  if (!correctPassword) {
    user.failedLoginAttempts += 1;

    const attempts = user.failedLoginAttempts;

    await createSecurityAuditLog({
      userId: user._id,
      event: "LOGIN_FAILED",
      description: "Invalid password",
      req,
      metadata: {
        failedAttempts: attempts,
      },
    });

    if (attempts >= 5) {
      user.lockUntil = Date.now() + 15 * 60 * 1000;

      user.failedLoginAttempts = 0;

      await createSecurityAuditLog({
        userId: user._id,
        event: "ACCOUNT_LOCKED",
        description:
          "Account temporarily locked after repeated failed login attempts",
        req,
        metadata: {
          lockDurationMinutes: 15,
        },
      });
    }

    await user.save();

    return next(new AppError("Invalid email or password", 401));
  }
  /*
  =====================================================
  7. PASSWORD IS CORRECT
  =====================================================

  Clear previous failed attempts and lock information.
  */

  user.failedLoginAttempts = 0;
  user.lockUntil = null;

  /*
  =====================================================
  8. EMAIL VERIFICATION
  =====================================================
  */

  if (!user.emailVerified) {
    await user.save({
      validateBeforeSave: false,
    });

    return next(
      new AppError("Please verify your email address before logging in.", 403),
    );
  }

  /*
  =====================================================
  9. ACCOUNT STATUS
  =====================================================
  */

  if (user.status === "blocked") {
    await user.save({
      validateBeforeSave: false,
    });

    return next(new AppError("Your account has been blocked.", 403));
  }

  if (user.status === "suspended") {
    await user.save({
      validateBeforeSave: false,
    });

    return next(new AppError("Your account has been suspended.", 403));
  }

  if (user.status === "closed") {
    await user.save({
      validateBeforeSave: false,
    });

    return next(new AppError("This account has been closed.", 403));
  }

  /*
  =====================================================
  10. UPDATE LOGIN INFORMATION
  =====================================================
  */

  user.lastLoginAt = new Date();

  user.lastLoginIp = req.ip || req.headers["x-forwarded-for"] || null;

  user.lastActiveAt = new Date();

  await user.save({
    validateBeforeSave: false,
  });

  /*
  =====================================================
  11. CREATE ACCESS TOKEN
  =====================================================
  */

  const accessToken = user.generateAccessToken();

  /*
  =====================================================
  12. CREATE REFRESH SESSION
  =====================================================

  This also generates the session-bound CSRF token.
  */

  const { refreshToken, csrfToken } = await createSession(user, req);

  /*
  =====================================================
  13. SET REFRESH TOKEN COOKIE
  =====================================================
  */

  res.cookie("refreshToken", refreshToken, getRefreshTokenCookieOptions());

  /*
  =====================================================
  14. RESPONSE
  =====================================================
  */

  res.status(200).json({
    status: "success",
    accessToken,
    csrfToken,
    data: {
      user,
    },
  });
});

// =========================================================
// GET CURRENT USER
// =========================================================

exports.getMe = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return next(new AppError("User no longer exists", 404));
  }

  res.status(200).json({
    status: "success",

    data: {
      user,
    },
  });
});

// =========================================================
// FORGOT PASSWORD
// =========================================================

exports.forgotPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return next(new AppError("Please provide your email address", 400));
  }

  const normalizedEmail = email.trim().toLowerCase();

  const user = await User.findOne({
    email: normalizedEmail,
  }).select("+passwordResetToken +passwordResetExpires");

  const genericMessage =
    "If an account with that email exists, a password reset link has been sent.";

  if (!user) {
    return res.status(200).json({
      status: "success",
      message: genericMessage,
    });
  }

  // -----------------------------------------------------
  // CREATE RESET TOKEN
  // -----------------------------------------------------

  const resetToken = user.createPasswordResetToken();

  await user.save({
    validateBeforeSave: false,
  });

  // -----------------------------------------------------
  // TODO:
  // SEND PASSWORD RESET EMAIL HERE
  // -----------------------------------------------------

  const response = {
    status: "success",
    message: genericMessage,
  };

  // Development only
  if (process.env.NODE_ENV === "development") {
    response.resetToken = resetToken;
  }

  res.status(200).json(response);
});

// =========================================================
// RESET PASSWORD
// =========================================================

exports.resetPassword = catchAsync(async (req, res, next) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!password) {
    return next(new AppError("Please provide a new password", 400));
  }

  if (password.length < 8) {
    return next(new AppError("Password must be at least 8 characters", 400));
  }

  // -----------------------------------------------------
  // HASH RESET TOKEN
  // -----------------------------------------------------

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  // -----------------------------------------------------
  // FIND USER
  // -----------------------------------------------------

  const user = await User.findOne({
    passwordResetToken: hashedToken,

    passwordResetExpires: {
      $gt: Date.now(),
    },
  }).select("+passwordResetToken +passwordResetExpires");

  if (!user) {
    return next(
      new AppError("Password reset token is invalid or has expired", 400),
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

  await Session.updateMany(
    {
      user: user._id,
      revoked: false,
    },
    {
      revoked: true,
      revokedAt: new Date(),
    },
  );

  // -----------------------------------------------------
  // RESPONSE
  // -----------------------------------------------------

  res.status(200).json({
    status: "success",

    message: "Password reset successfully. Please log in again.",
  });
});

// =========================================================
// REFRESH ACCESS TOKEN
// =========================================================

exports.refreshAccessToken = catchAsync(async (req, res, next) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return next(new AppError("Refresh token is required", 401));
  }

  // -----------------------------------------------------
  // HASH REFRESH TOKEN
  // -----------------------------------------------------

  const refreshTokenHash = hashRefreshToken(refreshToken);

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

  if (!session) {
    res.clearCookie("refreshToken", getRefreshTokenCookieOptions());

    return next(new AppError("Invalid or expired session", 401));
  }

  // -----------------------------------------------------
  // FIND USER
  // -----------------------------------------------------

  const user = await User.findById(session.user);

  if (!user) {
    return next(new AppError("User no longer exists", 401));
  }

  // -----------------------------------------------------
  // CHECK ACCOUNT STATUS
  // -----------------------------------------------------

  if (
    user.status === "blocked" ||
    user.status === "suspended" ||
    user.status === "closed"
  ) {
    return next(new AppError("This account cannot be authenticated", 403));
  }

  // -----------------------------------------------------
  // ROTATE REFRESH TOKEN
  // -----------------------------------------------------

  const newRefreshToken = generateRefreshToken();

  const newCsrfToken = generateCsrfToken();

  session.refreshTokenHash = hashRefreshToken(newRefreshToken);

  session.csrfTokenHash = hashCsrfToken(newCsrfToken);

  session.lastUsedAt = new Date();

  await session.save();

  // -----------------------------------------------------
  // SET NEW COOKIE
  // -----------------------------------------------------

  res.cookie("refreshToken", newRefreshToken, getRefreshTokenCookieOptions());

  // -----------------------------------------------------
  // GENERATE NEW ACCESS TOKEN
  // -----------------------------------------------------

  const accessToken = user.generateAccessToken();

  res.status(200).json({
    status: "success",
    accessToken,
    csrfToken: newCsrfToken,
  });
});

// =========================================================
// LOGOUT CURRENT SESSION
// =========================================================

exports.logout = catchAsync(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (refreshToken) {
    const refreshTokenHash = hashRefreshToken(refreshToken);

    await Session.findOneAndUpdate(
      {
        refreshTokenHash,
        revoked: false,
      },
      {
        revoked: true,
        revokedAt: new Date(),
      },
    );
  }

  res.clearCookie("refreshToken", getRefreshTokenCookieOptions());

  res.status(200).json({
    status: "success",
    message: "Logged out successfully",
  });
});

// =========================================================
// LOGOUT ALL SESSIONS
// =========================================================

exports.logoutAllSessions = catchAsync(async (req, res) => {
  await Session.updateMany(
    {
      user: req.user._id,

      revoked: false,
    },
    {
      revoked: true,

      revokedAt: new Date(),
    },
  );

  res.clearCookie("refreshToken", getRefreshTokenCookieOptions());

  res.status(200).json({
    status: "success",

    message: "All sessions have been logged out successfully",
  });
});

// =========================================================
// GET CSRF TOKEN
// =========================================================

// exports.getCsrfToken = (req, res) => {
//   const csrfToken = generateCsrfToken();

//   res.cookie("csrfToken", csrfToken, {
//     httpOnly: false,

//     secure: process.env.COOKIE_SECURE === "true",

//     sameSite: process.env.COOKIE_SAME_SITE || "lax",

//     maxAge: 30 * 60 * 1000,

//     path: "/",
//   });

//   res.status(200).json({
//     status: "success",

//     csrfToken,
//   });
// };
