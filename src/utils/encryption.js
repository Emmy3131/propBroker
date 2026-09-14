const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";

const getEncryptionKey = () => {
  const key = process.env.TWO_FACTOR_ENCRYPTION_KEY;

  if (!key) {
    throw new Error(
      "TWO_FACTOR_ENCRYPTION_KEY is not configured"
    );
  }

  const buffer = Buffer.from(key, "hex");

  if (buffer.length !== 32) {
    throw new Error(
      "TWO_FACTOR_ENCRYPTION_KEY must be a 32-byte hexadecimal key"
    );
  }

  return buffer;
};

// =========================================================
// ENCRYPT
// =========================================================

const encrypt = (text) => {
  const key = getEncryptionKey();

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    ALGORITHM,
    key,
    iv
  );

  let encrypted = cipher.update(
    text,
    "utf8",
    "hex"
  );

  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
};

// =========================================================
// DECRYPT
// =========================================================

const decrypt = (
  encrypted,
  iv,
  authTag
) => {
  const key = getEncryptionKey();

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "hex")
  );

  decipher.setAuthTag(
    Buffer.from(authTag, "hex")
  );

  let decrypted = decipher.update(
    encrypted,
    "hex",
    "utf8"
  );

  decrypted += decipher.final("utf8");

  return decrypted;
};

module.exports = {
  encrypt,
  decrypt,
};