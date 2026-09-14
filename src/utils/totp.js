const crypto = require("crypto");

const {
  encrypt,
  decrypt,
} = require("./encryption");

// =========================================================
// TOTP CONFIGURATION
// =========================================================

const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = "sha1";

// Accept:
// - previous 30-second window
// - current 30-second window
// - next 30-second window
//
// This allows approximately ±30 seconds of clock drift.
const TOTP_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// =========================================================
// BASE32 ENCODER
// =========================================================

const base32Encode = (buffer) => {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
};

// =========================================================
// BASE32 DECODER
// =========================================================

const base32Decode = (input) => {
  const normalized = input
    .replace(/[\s=-]/g, "")
    .toUpperCase();

  let bits = 0;
  let value = 0;

  const bytes = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);

    if (index === -1) {
      throw new Error("Invalid Base32 secret");
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push(
        (value >>> (bits - 8)) & 0xff
      );

      bits -= 8;
    }
  }

  return Buffer.from(bytes);
};

// =========================================================
// GENERATE TOTP SECRET
// =========================================================

const generateTotpSecret = () => {
  // 20 bytes = 160 bits.
  //
  // This is a strong secret size for TOTP.
  const randomBytes = crypto.randomBytes(20);

  return base32Encode(randomBytes);
};

// =========================================================
// GENERATE TOTP
// =========================================================

const generateTotpToken = (
  secret,
  timestamp = Date.now()
) => {
  const key = base32Decode(secret);

  const counter = Math.floor(
    timestamp / 1000 / TOTP_PERIOD
  );

  const counterBuffer = Buffer.alloc(8);

  counterBuffer.writeBigUInt64BE(
    BigInt(counter)
  );

  const hmac = crypto
    .createHmac(TOTP_ALGORITHM, key)
    .update(counterBuffer)
    .digest();

  // Dynamic truncation from RFC 4226
  const offset =
    hmac[hmac.length - 1] & 0x0f;

  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp =
    binaryCode % Math.pow(10, TOTP_DIGITS);

  return otp
    .toString()
    .padStart(TOTP_DIGITS, "0");
};

// =========================================================
// CONSTANT-TIME STRING COMPARISON
// =========================================================

const safeCompare = (
  first,
  second
) => {
  const firstBuffer = Buffer.from(
    String(first)
  );

  const secondBuffer = Buffer.from(
    String(second)
  );

  if (
    firstBuffer.length !==
    secondBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    firstBuffer,
    secondBuffer
  );
};

// =========================================================
// VERIFY TOTP
// =========================================================

const verifyTotp = (
  token,
  secret
) => {
  if (!token || !secret) {
    return false;
  }

  const normalizedToken =
    String(token).trim();

  // TOTP must be exactly 6 digits
  if (!/^\d{6}$/.test(normalizedToken)) {
    return false;
  }

  const now = Date.now();

  for (
    let offset = -TOTP_WINDOW;
    offset <= TOTP_WINDOW;
    offset++
  ) {
    const timestamp =
      now +
      offset *
        TOTP_PERIOD *
        1000;

    const expectedToken =
      generateTotpToken(
        secret,
        timestamp
      );

    if (
      safeCompare(
        normalizedToken,
        expectedToken
      )
    ) {
      return true;
    }
  }

  return false;
};

// =========================================================
// GENERATE OTP AUTH URL
// =========================================================

const generateOtpAuthUrl = ({
  email,
  secret,
}) => {
  if (!email || !secret) {
    throw new Error(
      "Email and TOTP secret are required"
    );
  }

  const issuer =
    process.env.TOTP_ISSUER ||
    "EmmCore Broker";

  const encodedIssuer =
    encodeURIComponent(issuer);

  const encodedEmail =
    encodeURIComponent(email);

  return (
    `otpauth://totp/` +
    `${encodedIssuer}:${encodedEmail}` +
    `?secret=${encodeURIComponent(secret)}` +
    `&issuer=${encodedIssuer}` +
    `&algorithm=SHA1` +
    `&digits=${TOTP_DIGITS}` +
    `&period=${TOTP_PERIOD}`
  );
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
// GENERATE ONE BACKUP CODE
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
      String(code)
        .trim()
        .toUpperCase()
    )
    .digest("hex");
};

// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  generateTotpSecret,
  generateTotpToken,
  generateOtpAuthUrl,
  verifyTotp,

  encryptTotpSecret,
  decryptTotpSecret,

  generateBackupCode,
  generateBackupCodes,
  hashBackupCode,
};