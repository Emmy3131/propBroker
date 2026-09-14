const crypto = require("crypto");

const generateCsrfToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

module.exports = {
  generateCsrfToken,
};
