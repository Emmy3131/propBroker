const crypto = require("crypto");

const otplib = require("otplib");

const {
  encrypt,
  decrypt,
} = require("./encryption");

// =========================================================
// GET AUTHENTICATOR
// =========================================================

const authenticator =
  otplib.authenticator;

// =========================================================
// GENERATE SECRET
// =========================================================

const generateTotpSecret = () => {
  return authenticator.generateSecret();
};

// =========================================================
// GENERATE OTP AUTH URL
// =========================================================

const generateOtpAuthUrl = ({
  email,
  secret,
}) => {
  return authenticator.keyuri(
    email,
    process.env.TOTP_ISSUER ||
      "EmmCore Broker",
    secret
  );
};

// =========================================================
// VERIFY TOTP
// =========================================================

const verifyTotp = (
  token,
  secret
) => {
  return authenticator.verify({
    token,
    secret,
  });
};

// =========================================================
// ENCRYPT TOTP SECRET
// =========================================================

const encryptTotpSecret = (
  secret
) => {
  return encrypt(secret);
};

// =========================================================
// DECRYPT TOTP SECRET
// =========================================================

const decryptTotpSecret = (
  encrypted,
  iv,
  authTag
) => {
  return decrypt(
    encrypted,
    iv,
    authTag
  );
};

// =========================================================
// GENERATE BACKUP CODE
// =========================================================

const generateBackupCode = () => {
  return crypto
    .randomBytes(8)
    .toString("hex")
    .toUpperCase();
};

// =========================================================
// GENERATE MULTIPLE BACKUP CODES
// =========================================================

const generateBackupCodes = (
  count = 10
) => {
  return Array.from(
    { length: count },
    () => generateBackupCode()
  );
};

// =========================================================
// HASH BACKUP CODE
// =========================================================

const hashBackupCode = (
  code
) => {
  return crypto
    .createHash("sha256")
    .update(
      code.trim().toUpperCase()
    )
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