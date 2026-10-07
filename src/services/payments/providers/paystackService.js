const AppError = require("../../../utils/appError");

const PAYSTACK_BASE_URL = "https://api.paystack.co";

/*
=====================================================
GET PAYSTACK SECRET KEY
=====================================================
*/

const getSecretKey = () => {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new AppError("PAYSTACK_SECRET_KEY is not configured.", 500);
  }

  return secretKey;
};

/*
=====================================================
CONVERT AMOUNT TO PAYSTACK SUBUNIT
=====================================================

NGN 100.00 -> 10000 kobo
USD 100.00 -> 10000 cents
*/

const amountToSubunit = (amount) => {
  const value = String(amount).trim();

  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new AppError(
      "Paystack currently requires amounts with at most 2 decimal places.",
      400
    );
  }

  const [whole, fraction = ""] = value.split(".");

  const paddedFraction = `${fraction}00`.slice(0, 2);

  return `${whole}${paddedFraction}`;
};

/*
=====================================================
PAYSTACK REQUEST
=====================================================
*/

const paystackRequest = async (path, options = {}) => {
  const secretKey = getSecretKey();

  let response;

  try {
    response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    throw new AppError(
      `Unable to connect to Paystack: ${error.message}`,
      502
    );
  }

  let body;

  try {
    body = await response.json();
  } catch (error) {
    throw new AppError(
      "Paystack returned an invalid response.",
      502
    );
  }

  if (!response.ok || !body.status) {
    throw new AppError(
      body.message || "Paystack request failed.",
      502
    );
  }

  return body;
};

/*
=====================================================
INITIALIZE PAYSTACK TRANSACTION
=====================================================
*/

const initializeTransaction = async ({
  email,
  amount,
  currency,
  reference,
  callbackUrl,
  metadata = {},
}) => {
  if (!email) {
    throw new AppError(
      "Customer email is required for Paystack payment.",
      400
    );
  }

  if (!amount) {
    throw new AppError(
      "Payment amount is required.",
      400
    );
  }

  if (!currency) {
    throw new AppError(
      "Payment currency is required.",
      400
    );
  }

  if (!reference) {
    throw new AppError(
      "Payment reference is required.",
      400
    );
  }

  const normalizedCurrency = String(currency).toUpperCase();

  const payload = {
    email: String(email).trim(),
    amount: amountToSubunit(amount),
    currency: normalizedCurrency,
    reference: String(reference).trim(),
    metadata,
  };

  if (callbackUrl) {
    payload.callback_url = callbackUrl;
  }

  return paystackRequest("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

/*
=====================================================
VERIFY PAYSTACK TRANSACTION
=====================================================
*/

const verifyTransaction = async (reference) => {
  if (!reference) {
    throw new AppError(
      "Paystack transaction reference is required.",
      400
    );
  }

  return paystackRequest(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: "GET",
    }
  );
};

/*
=====================================================
EXPORTS
=====================================================
*/

module.exports = {
  amountToSubunit,
  initializeTransaction,
  verifyTransaction,
};