const crypto = require("crypto");

const QRCode = require("qrcode");

const User = require("../models/UserModel");

const AppError = require("../utils/appError");

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

const { getRefreshTokenCookieOptions } = require("../config/cookies");

const { createSecurityAuditLog } = require("../utils/securityAudit");

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

  /*
    =====================================================
    GENERATE NEW TOTP SECRET
    =====================================================
    */

  const secret = generateTotpSecret();

  const encrypted = encryptTotpSecret(secret);

  /*
    =====================================================
    STORE ENCRYPTED SECRET
    =====================================================

    The actual TOTP secret is NEVER stored directly.
    */

  user.twoFactorSecret = encrypted.encrypted;

  user.twoFactorSecretIV = encrypted.iv;

  user.twoFactorSecretAuthTag = encrypted.authTag;

  await user.save({
    validateBeforeSave: false,
  });

  /*
    =====================================================
    GENERATE AUTHENTICATOR URL
    =====================================================
    */

  const otpAuthUrl = generateOtpAuthUrl({
    email: user.email,
    secret,
  });

  /*
    =====================================================
    GENERATE QR CODE
    =====================================================
    */

  const qrCode = await QRCode.toDataURL(otpAuthUrl);

  /*
    =====================================================
    RESPONSE
    =====================================================
    */

  res.status(200).json({
    status: "success",

    message:
      "Scan the QR code with your authenticator app and verify the generated code.",

    data: {
      qrCode,

      /*
        This is shown once so the user can manually
        enter the secret into an authenticator app.
        */

      manualSecret: secret,
    },
  });
});

// =========================================================
// VERIFY 2FA SETUP
// =========================================================

exports.verifyTwoFactorSetup = catchAsync(async (req, res, next) => {
  const { token } = req.body;

  /*
    =====================================================
    VALIDATE TOKEN
    =====================================================
    */

  if (!token) {
    return next(new AppError("Please provide your authenticator code.", 400));
  }

  if (!/^\d{6}$/.test(token)) {
    return next(new AppError("Authenticator code must be 6 digits.", 400));
  }

  /*
    =====================================================
    FIND USER
    =====================================================
    */

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

  /*
    =====================================================
    DECRYPT TOTP SECRET
    =====================================================
    */

  const secret = decryptTotpSecret(
    user.twoFactorSecret,
    user.twoFactorSecretIV,
    user.twoFactorSecretAuthTag,
  );

  /*
    =====================================================
    VERIFY TOTP
    =====================================================
    */

  const valid = verifyTotp(token, secret);

  /*
    =====================================================
    INVALID CODE
    =====================================================
    */

  if (!valid) {
    await createSecurityAuditLog({
      userId: user._id,

      event: "2FA_FAILED",

      description:
        "Invalid authenticator code provided while enabling two-factor authentication.",

      req,
    });

    return next(new AppError("Invalid authenticator code.", 400));
  }

  /*
    =====================================================
    GENERATE BACKUP CODES
    =====================================================
    */

  const backupCodes = generateBackupCodes(10);

  /*
    Store only hashes in MongoDB.
    */

  const hashedBackupCodes = backupCodes.map(hashBackupCode);

  /*
    =====================================================
    ENABLE 2FA
    =====================================================
    */

  user.twoFactorEnabled = true;

  user.twoFactorEnabledAt = new Date();

  user.twoFactorBackupCodes = hashedBackupCodes;

  await user.save({
    validateBeforeSave: false,
  });

  /*
    =====================================================
    SECURITY AUDIT
    =====================================================
    */

  await createSecurityAuditLog({
    userId: user._id,

    event: "2FA_ENABLED",

    description: "Two-factor authentication was successfully enabled.",

    req,

    metadata: {
      backupCodesGenerated: backupCodes.length,
    },
  });

  /*
    =====================================================
    RESPONSE
    =====================================================

    IMPORTANT:

    The raw backup codes are returned only now.

    They are never stored in the database and never
    written to the audit log.
    */

  res.status(200).json({
    status: "success",

    message:
      "Two-factor authentication has been enabled. Save your backup codes in a secure location.",

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

  /*
    =====================================================
    VALIDATE TOKEN
    =====================================================
    */

  if (!token) {
    return next(new AppError("Please provide your authenticator code.", 400));
  }

  if (!/^\d{6}$/.test(token)) {
    return next(new AppError("Authenticator code must be 6 digits.", 400));
  }

  /*
    =====================================================
    FIND USER
    =====================================================
    */

  const user = await User.findById(req.user._id).select(
    "+twoFactorSecret +twoFactorSecretIV +twoFactorSecretAuthTag",
  );

  if (!user) {
    return next(new AppError("User no longer exists.", 404));
  }

  if (!user.twoFactorEnabled) {
    return next(new AppError("Two-factor authentication is not enabled.", 400));
  }

  /*
    =====================================================
    DECRYPT SECRET
    =====================================================
    */

  const secret = decryptTotpSecret(
    user.twoFactorSecret,
    user.twoFactorSecretIV,
    user.twoFactorSecretAuthTag,
  );

  /*
    =====================================================
    VERIFY CURRENT TOTP
    =====================================================
    */

  const valid = verifyTotp(token, secret);

  if (!valid) {
    await createSecurityAuditLog({
      userId: user._id,

      event: "2FA_FAILED",

      description:
        "Invalid authenticator code provided while disabling two-factor authentication.",

      req,
    });

    return next(new AppError("Invalid authenticator code.", 400));
  }

  /*
    =====================================================
    DISABLE 2FA
    =====================================================
    */

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

  /*
    =====================================================
    SECURITY AUDIT
    =====================================================
    */

  await createSecurityAuditLog({
    userId: user._id,

    event: "2FA_DISABLED",

    description: "Two-factor authentication was disabled.",

    req,
  });

  /*
    =====================================================
    RESPONSE
    =====================================================
    */

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

  /*
    =====================================================
    VALIDATE INPUT
    =====================================================
    */

  if (!challenge || !token) {
    return next(
      new AppError("Challenge and authentication code are required.", 400),
    );
  }

  /*
    =====================================================
    VALIDATE TOTP FORMAT
    =====================================================
    */

  const isTotpFormat = /^\d{6}$/.test(token);

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
    await createSecurityAuditLog({
      userId: challengeDoc.user,

      event: "2FA_FAILED",

      description:
        "Two-factor authentication challenge exceeded the maximum number of attempts.",

      req,

      metadata: {
        attempts: challengeDoc.attempts,

        maxAttempts: challengeDoc.maxAttempts,
      },
    });

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
    CHECK ACCOUNT STATUS
    =====================================================
    */

  if (user.status === "blocked") {
    await TwoFactorChallenge.deleteOne({
      _id: challengeDoc._id,
    });

    return next(new AppError("Your account has been blocked.", 403));
  }

  if (user.status === "suspended") {
    await TwoFactorChallenge.deleteOne({
      _id: challengeDoc._id,
    });

    return next(new AppError("Your account has been suspended.", 403));
  }

  if (user.status === "closed") {
    await TwoFactorChallenge.deleteOne({
      _id: challengeDoc._id,
    });

    return next(new AppError("This account has been closed.", 403));
  }

  /*
    =====================================================
    VERIFY TOTP
    =====================================================
    */

  let valid = false;

  let usedBackupCode = false;

  /*
    Only attempt TOTP verification when the input has
    the expected 6-digit format.
    */

  if (isTotpFormat) {
    const secret = decryptTotpSecret(
      user.twoFactorSecret,
      user.twoFactorSecretIV,
      user.twoFactorSecretAuthTag,
    );

    valid = verifyTotp(token, secret);
  }

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

      usedBackupCode = true;

      /*
        Recovery codes are ONE-TIME USE.
        */

      user.twoFactorBackupCodes.splice(codeIndex, 1);

      await createSecurityAuditLog({
        userId: user._id,

        event: "BACKUP_CODE_USED",

        description: "A two-factor recovery code was used successfully.",

        req,

        metadata: {
          remainingBackupCodes: user.twoFactorBackupCodes.length,
        },
      });
    }
  }

  /*
    =====================================================
    INVALID AUTHENTICATION CODE
    =====================================================
    */

  if (!valid) {
    await createSecurityAuditLog({
      userId: user._id,

      event: "2FA_FAILED",

      description: "Invalid TOTP or recovery code provided during login.",

      req,

      metadata: {
        attempt: challengeDoc.attempts,

        maxAttempts: challengeDoc.maxAttempts,
      },
    });

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
    RESET LOGIN SECURITY STATE
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
    SECURITY AUDIT - 2FA SUCCESS
    =====================================================
    */

  await createSecurityAuditLog({
    userId: user._id,

    event: "2FA_SUCCESS",

    description: usedBackupCode
      ? "Two-factor authentication completed using a recovery code."
      : "Two-factor authentication completed using an authenticator code.",

    req,

    metadata: {
      method: usedBackupCode ? "backup_code" : "totp",
    },
  });

  /*
    =====================================================
    SECURITY AUDIT - LOGIN SUCCESS
    =====================================================

    At this point both password and 2FA have succeeded,
    so the login is fully authenticated.
    */

  await createSecurityAuditLog({
    userId: user._id,

    event: "LOGIN_SUCCESS",

    description:
      "User successfully completed password and two-factor authentication.",

    req,

    metadata: {
      twoFactor: true,

      method: usedBackupCode ? "backup_code" : "totp",
    },
  });

  /*
    =====================================================
    DELETE USED CHALLENGE
    =====================================================
    */

  await TwoFactorChallenge.deleteOne({
    _id: challengeDoc._id,
  });

  /*
    =====================================================
    CREATE AUTHENTICATED SESSION
    =====================================================
    */

  const { refreshToken, csrfToken } = await createSession(user, req);

  /*
    =====================================================
    SET REFRESH TOKEN COOKIE
    =====================================================
    */

  res.cookie("refreshToken", refreshToken, getRefreshTokenCookieOptions());

  /*
    =====================================================
    GENERATE ACCESS TOKEN
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
