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
  /*
  =====================================================
  GET REQUEST BODY
  =====================================================
  */

  const { name, email, password, phone, country, referralCode } =
    req.body || {};

  /*
  =====================================================
  VALIDATE REQUIRED FIELDS
  =====================================================
  */

  if (!name || !email || !password) {
    return next(new AppError("Name, email and password are required", 400));
  }

  /*
  =====================================================
  NORMALIZE INPUT
  =====================================================
  */

  const normalizedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  /*
  =====================================================
  VALIDATE PASSWORD
  =====================================================
  */

  if (password.length < 8) {
    return next(new AppError("Password must be at least 8 characters", 400));
  }

  /*
  =====================================================
  CHECK EXISTING USER
  =====================================================
  */

  const existingUser = await User.findOne({
    email: normalizedEmail,
  });

  if (existingUser) {
    return next(new AppError("An account with this email already exists", 409));
  }

  /*
  =====================================================
  GENERATE UNIQUE REFERRAL CODE
  =====================================================
  */

  let generatedReferralCode;

  while (!generatedReferralCode) {
    const candidate = crypto.randomBytes(4).toString("hex").toUpperCase();

    const existingCode = await User.findOne({
      referralCode: candidate,
    });

    if (!existingCode) {
      generatedReferralCode = candidate;
    }
  }

  /*
  =====================================================
  FIND REFERRER
  =====================================================
  */

  let referredBy = null;

  if (referralCode) {
    const normalizedReferralCode = referralCode.trim().toUpperCase();

    const referrer = await User.findOne({
      referralCode: normalizedReferralCode,
    });

    if (referrer) {
      referredBy = referrer._id;
    }
  }

  /*
  =====================================================
  CREATE USER
  =====================================================
  */

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

  /*
  =====================================================
  CREATE EMAIL VERIFICATION TOKEN
  =====================================================
  */

  const verificationToken = user.createEmailVerificationToken();

  /*
  =====================================================
  SAVE USER
  =====================================================
  */

  await user.save();

  /*
  =====================================================
  SEND VERIFICATION EMAIL
  =====================================================
  */

  try {
    await sendVerificationEmail({
      name: user.name,
      email: user.email,
      verificationToken,
    });
  } catch (error) {
    console.error("Verification email failed:", error);

    /*
    -----------------------------------------------------
    Remove unusable verification token
    -----------------------------------------------------
    */

    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;

    await user.save({
      validateBeforeSave: false,
    });

    /*
    -----------------------------------------------------
    Account still exists.
    Tell frontend to use resend verification.
    -----------------------------------------------------
    */

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

  /*
  =====================================================
  RESPONSE
  =====================================================
  */

  const response = {
    status: "success",

    message: "Account created. Please verify your email address.",

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

  /*
  =====================================================
  DEVELOPMENT ONLY
  =====================================================
  */

  if (process.env.NODE_ENV === "development") {
    response.verificationToken = verificationToken;
  }

  /*
  =====================================================
  SEND RESPONSE
  =====================================================
  */

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
  const { email, password } = req.body || {};

  /*
    =================================================
    VALIDATE INPUT
    =================================================
    */

  if (!email || !password) {
    return next(new AppError("Please provide email and password.", 400));
  }

  const normalizedEmail = email.trim().toLowerCase();

  /*
    =================================================
    FIND USER
    =================================================
    
    Password is select:false in the User model,
    so we explicitly request it.
    */

  const user = await User.findOne({
    email: normalizedEmail,
  }).select("+password +failedLoginAttempts +lockUntil");

  if (!user) {
    return next(new AppError("Incorrect email or password.", 401));
  }

  /*
    =================================================
    CHECK ACCOUNT LOCK
    =================================================
    */

  if (user.isLocked()) {
    return next(
      new AppError(
        "Your account is temporarily locked. Please try again later.",
        423,
      ),
    );
  }

  /*
    =================================================
    CHECK PASSWORD
    =================================================
    */

  const correctPassword = await user.correctPassword(password, user.password);

  if (!correctPassword) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;

    /*
        Lock account after 5 failed attempts.
        */

    if (user.failedLoginAttempts >= 5) {
      user.lockUntil = Date.now() + 15 * 60 * 1000;

      user.failedLoginAttempts = 0;
    }

    await user.save({
      validateBeforeSave: false,
    });

    return next(new AppError("Incorrect email or password.", 401));
  }

  /*
    =================================================
    RESET LOGIN ATTEMPTS
    =================================================
    */

  if (user.failedLoginAttempts || user.lockUntil) {
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;

    await user.save({
      validateBeforeSave: false,
    });
  }

  /*
    =================================================
    EMAIL VERIFICATION
    =================================================
    */

  if (!user.emailVerified) {
    return next(
      new AppError("Please verify your email address before logging in.", 403),
    );
  }

  /*
    =================================================
    ACCOUNT STATUS
    =================================================
    */

  if (["suspended", "blocked", "closed"].includes(user.status)) {
    return next(new AppError("Your account is not allowed to log in.", 403));
  }

  /*
    =================================================
    CREATE ACCESS TOKEN
    =================================================
    */

  const accessToken = user.generateAccessToken();

  /*
    =================================================
    CREATE REFRESH TOKEN
    =================================================
    */

  const refreshToken = generateRefreshToken();

  const hashedRefreshToken = hashRefreshToken(refreshToken);

  /*
    =================================================
    CREATE SESSION
    =================================================
    */

  await Session.create({
    user: user._id,
    refreshToken: hashedRefreshToken,
    expiresAt: getRefreshTokenExpiration(),
  });

  /*
    =================================================
    REFRESH TOKEN COOKIE
    =================================================
    */

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  /*
    =================================================
    RESPONSE
    =================================================
    */

  res.status(200).json({
    status: "success",

    message: "Login successful.",

    accessToken,

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
