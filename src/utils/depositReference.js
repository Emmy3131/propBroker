const crypto = require("crypto");

const generateDepositReference = () => {
  const randomPart = crypto.randomBytes(8).toString("hex").toUpperCase();

  return `DEP-${Date.now()}-${randomPart}`;
};

module.exports = {
  generateDepositReference,
};
