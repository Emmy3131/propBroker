const AppError = require("../../utils/appError");

const rapydProvider = require("./providers/rapydProvider");

const providers = {
  rapyd: rapydProvider,
};

const getPaymentProvider = (providerName = "rapyd") => {
  const normalizedProvider = String(providerName).trim().toLowerCase();

  const provider = providers[normalizedProvider];

  if (!provider) {
    throw new AppError(`Unsupported payment provider: ${providerName}`, 400);
  }

  return provider;
};

module.exports = {
  getPaymentProvider,
};
