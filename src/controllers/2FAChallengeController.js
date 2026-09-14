const crypto = require("crypto");

const QRCode = require("qrcode");

const User = require("../models/UserModel");

const AppError = require("../utils/AppError");

const {
  generateTotpSecret,
  generateOtpAuthUrl,
  verifyTotp,
  encryptTotpSecret,
  decryptTotpSecret,
  generateBackupCodes,
  hashBackupCode,
} = require("../utils/totp");

const catchAsync = require("../utils/catchAsync");
const TwoFactorChallenge = require("../models/TwiFactorChallengeModel");
const { createSession } = require("../utils/sessions");
const {
  generateRefreshToken,
  hashRefreshToken,
  generateCsrfToken,
  hashCsrfToken,
  getRefreshTokenExpiration,
} = require("../utils/authTokens");

// =========================================================
// SETUP 2FA
// =========================================================

exports.setupTwoFactor = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id).select(
    "+twoFactorSecret +twoFactorSecretIV +twoFactorSecretAuthTag",
  );

  if (!user) {
    return next(new AppError("User no longer exists.", 404));
  }

  if (user.twoFactorEnabled) {
    return next(
      new AppError("Two-factor authentication is already enabled.", 400),
    );
  }

  // Generate new secret
  const secret = generateTotpSecret();

  const encrypted = encryptTotpSecret(secret);

  // Store encrypted secret temporarily
  user.twoFactorSecret = encrypted.encrypted;

  user.twoFactorSecretIV = encrypted.iv;

  user.twoFactorSecretAuthTag = encrypted.authTag;

  await user.save({
    validateBeforeSave: false,
  });

  // Generate Authenticator URL
  const otpAuthUrl = generateOtpAuthUrl({
    email: user.email,
    secret,
  });

  // Generate QR code
  const qrCode = await QRCode.toDataURL(otpAuthUrl);

  res.status(200).json({
    status: "success",
    message:
      "Scan the QR code with your authenticator app and verify the generated code.",
    data: {
      qrCode,
      manualSecret: secret,
    },
  });
});

// =========================================================
// VERIFY 2FA SETUP
// =========================================================

exports.verifyTwoFactorSetup = catchAsync(async (req, res, next) => {
  const { token } = req.body;

  if (!token) {
    return next(new AppError("Please provide your authenticator code.", 400));
  }

  if (!/^\d{6}$/.test(token)) {
    return next(new AppError("Authenticator code must be 6 digits.", 400));
  }

  const user = await User.findById(req.user._id).select(
    "+twoFactorSecret +twoFactorSecretIV +twoFactorSecretAuthTag",
  );

  if (!user) {
    return next(new AppError("User no longer exists.", 404));
  }

  if (user.twoFactorEnabled) {
    return next(
      new AppError("Two-factor authentication is already enabled.", 400),
    );
  }

  if (!user.twoFactorSecret) {
    return next(new AppError("Please initialize 2FA setup first.", 400));
  }

  const secret = decryptTotpSecret(
    user.twoFactorSecret,
    user.twoFactorSecretIV,
    user.twoFactorSecretAuthTag,
  );

  const valid = verifyTotp(token, secret);

  if (!valid) {
    return next(new AppError("Invalid authenticator code.", 400));
  }

  // =====================================================
  // GENERATE BACKUP CODES
  // =====================================================

  const backupCodes = generateBackupCodes(10);

  const hashedBackupCodes = backupCodes.map(hashBackupCode);

  // =====================================================
  // ENABLE 2FA
  // =====================================================

  user.twoFactorEnabled = true;

  user.twoFactorEnabledAt = new Date();

  user.twoFactorBackupCodes = hashedBackupCodes;

  await user.save({
    validateBeforeSave: false,
  });

  res.status(200).json({
    status: "success",

    message: "Two-factor authentication has been enabled.",

    data: {
      backupCodes,
    },
  });
});

// =========================================================
// DISABLE 2FA
// =========================================================

exports.disableTwoFactor = catchAsync(async (req, res, next) => {
  const { token } = req.body;

  if (!token) {
    return next(new AppError("Please provide your authenticator code.", 400));
  }

  const user = await User.findById(req.user._id).select(
    "+twoFactorSecret +twoFactorSecretIV +twoFactorSecretAuthTag",
  );

  if (!user) {
    return next(new AppError("User no longer exists.", 404));
  }

  if (!user.twoFactorEnabled) {
    return next(new AppError("Two-factor authentication is not enabled.", 400));
  }

  const secret = decryptTotpSecret(
    user.twoFactorSecret,
    user.twoFactorSecretIV,
    user.twoFactorSecretAuthTag,
  );

  const valid = verifyTotp(token, secret);

  if (!valid) {
    return next(new AppError("Invalid authenticator code.", 400));
  }

  user.twoFactorEnabled = false;

  user.twoFactorSecret = undefined;

  user.twoFactorSecretIV = undefined;

  user.twoFactorSecretAuthTag = undefined;

  user.twoFactorBackupCodes = [];

  user.twoFactorEnabledAt = null;

  user.twoFactorLastUsedAt = null;

  await user.save({
    validateBeforeSave: false,
  });

  res.status(200).json({
    status: "success",
    message: "Two-factor authentication has been disabled.",
  });
});

// =========================================================
// VERIFY LOGIN 2FA
// =========================================================

exports.verifyLoginTwoFactor = catchAsync(async (req, res, next) => {
  const { challenge, token } = req.body;

  if (!challenge || !token) {
    return next(
      new AppError("Challenge and authentication code are required.", 400),
    );
  }

  /*
    =====================================================
    HASH CHALLENGE
    =====================================================
    */

  const challengeHash = crypto
    .createHash("sha256")
    .update(challenge)
    .digest("hex");

  /*
    =====================================================
    FIND CHALLENGE
    =====================================================
    */

  const challengeDoc = await TwoFactorChallenge.findOne({
    challengeHash,

    expiresAt: {
      $gt: new Date(),
    },
  }).select("+challengeHash");

  if (!challengeDoc) {
    return next(new AppError("2FA challenge is invalid or expired.", 401));
  }

  /*
    =====================================================
    ATTEMPT LIMIT
    =====================================================
    */

  if (challengeDoc.attempts >= challengeDoc.maxAttempts) {
    await TwoFactorChallenge.deleteOne({
      _id: challengeDoc._id,
    });

    return next(
      new AppError("Too many 2FA attempts. Please login again.", 429),
    );
  }

  /*
    =====================================================
    INCREMENT ATTEMPT
    =====================================================
    */

  challengeDoc.attempts += 1;

  await challengeDoc.save();

  /*
    =====================================================
    FIND USER
    =====================================================
    */

  const user = await User.findById(challengeDoc.user).select(
    "+twoFactorSecret +twoFactorSecretIV +twoFactorSecretAuthTag +twoFactorBackupCodes",
  );

  if (!user) {
    return next(new AppError("User no longer exists.", 401));
  }

  /*
    =====================================================
    VERIFY TOTP
    =====================================================
    */

  let valid = false;

  const secret = decryptTotpSecret(
    user.twoFactorSecret,
    user.twoFactorSecretIV,
    user.twoFactorSecretAuthTag,
  );

  valid = verifyTotp(token, secret);

  /*
    =====================================================
    BACKUP CODE FALLBACK
    =====================================================
    */

  if (!valid) {
    const hashedCode = hashBackupCode(token);

    const codeIndex = user.twoFactorBackupCodes.indexOf(hashedCode);

    if (codeIndex !== -1) {
      valid = true;

      /*
        Recovery codes are ONE-TIME USE.
        */

      user.twoFactorBackupCodes.splice(codeIndex, 1);
    }
  }

  if (!valid) {
    return next(new AppError("Invalid authentication code.", 401));
  }

  /*
    =====================================================
    UPDATE 2FA USAGE
    =====================================================
    */

  user.twoFactorLastUsedAt = new Date();

  /*
    =====================================================
    RESET LOGIN STATE
    =====================================================
    */

  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.lastLoginAt = new Date();

  user.lastLoginIp = req.ip || req.headers["x-forwarded-for"] || null;

  user.lastActiveAt = new Date();

  await user.save({
    validateBeforeSave: false,
  });

  /*
    =====================================================
    DELETE CHALLENGE
    =====================================================
    */

  await TwoFactorChallenge.deleteOne({
    _id: challengeDoc._id,
  });

  /*
    =====================================================
    CREATE SESSION
    =====================================================
    */

  const { refreshToken, csrfToken } = await createSession(user, req);

  /*
    =====================================================
    SET REFRESH COOKIE
    =====================================================
    */

  res.cookie("refreshToken", refreshToken, getRefreshTokenCookieOptions());

  /*
    =====================================================
    ACCESS TOKEN
    =====================================================
    */

  const accessToken = user.generateAccessToken();

  /*
    =====================================================
    RESPONSE
    =====================================================
    */

  res.status(200).json({
    status: "success",

    accessToken,

    csrfToken,

    requiresTwoFactor: false,

    data: {
      user,
    },
  });
});
