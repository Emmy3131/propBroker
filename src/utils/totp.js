const crypto = require("crypto");

const { authenticator } = require("otplib");

const { encrypt, decrypt } = require("./encryption");

// =========================================================
// TOTP CONFIGURATION
// =========================================================

authenticator.options = {
  step: 30,
  window: 1,
};

// =========================================================
// GENERATE SECRET
// =========================================================

const generateTotpSecret = () => {
  return authenticator.generateSecret();
};

// =========================================================
// CREATE OTP AUTHENTICATION URI
// =========================================================

const generateOtpAuthUrl = ({ email, secret }) => {
  return authenticator.keyuri(
    email,
    process.env.TOTP_ISSUER || "EmmCore Broker",
    secret,
  );
};

// =========================================================
// VERIFY TOTP
// =========================================================

const verifyTotp = (token, secret) => {
  return authenticator.verify({
    token,
    secret,
  });
};

// =========================================================
// ENCRYPT SECRET
// =========================================================

const encryptTotpSecret = (secret) => {
  return encrypt(secret);
};

// =========================================================
// DECRYPT SECRET
// =========================================================

const decryptTotpSecret = (encrypted, iv, authTag) => {
  return decrypt(encrypted, iv, authTag);
};

// =========================================================
// BACKUP CODE
// =========================================================

const generateBackupCode = () => {
  return crypto.randomBytes(8).toString("hex").toUpperCase();
};

const generateBackupCodes = (count = 10) => {
  return Array.from({ length: count }, generateBackupCode);
};

// =========================================================
// HASH BACKUP CODE
// =========================================================

const hashBackupCode = (code) => {
  return crypto
    .createHash("sha256")
    .update(code.trim().toUpperCase())
    .digest("hex");
};

module.exports = {
  generateTotpSecret,
  generateOtpAuthUrl,
  verifyTotp,
  encryptTotpSecret,
  decryptTotpSecret,
  generateBackupCodes,
  hashBackupCode,
};
