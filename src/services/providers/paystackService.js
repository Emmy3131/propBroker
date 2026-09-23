const AppError = require("../../utils/appError");

const PAYSTACK_BASE_URL = "https://api.paystack.co";

const getSecretKey = () => {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured");
  }

  return process.env.PAYSTACK_SECRET_KEY;
};

/**
 * Convert our Decimal amount into Paystack's subunit.
 *
 * Example:
 * NGN 100.00 -> 10000 kobo
 * USD 100.00 -> 10000 cents
 */
const amountToSubunit = (amount) => {
  const value = String(amount);

  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new AppError(
      "Paystack currently requires amounts with at most 2 decimal places.",
      400,
    );
  }

  const [whole, fraction = ""] = value.split(".");

  const paddedFraction = `${fraction}00`.slice(0, 2);

  return `${whole}${paddedFraction}`;
};

/**
 * Make an authenticated request to Paystack.
 */
const paystackRequest = async (path, options = {}) => {
  const secretKey = getSecretKey();

  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  let body;

  try {
    body = await response.json();
  } catch (error) {
    throw new AppError("Paystack returned an invalid response.", 502);
  }

  if (!response.ok || !body.status) {
    throw new AppError(body.message || "Paystack request failed.", 502);
  }

  return body;
};

/**
 * Initialize a Paystack transaction.
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
    throw new AppError("Customer email is required for Paystack payment.", 400);
  }

  if (!amount) {
    throw new AppError("Payment amount is required.", 400);
  }

  if (!currency) {
    throw new AppError("Payment currency is required.", 400);
  }

  if (!reference) {
    throw new AppError("Payment reference is required.", 400);
  }

  const payload = {
    email,
    amount: amountToSubunit(amount),
    currency: currency.toUpperCase(),
    reference,
    metadata: JSON.stringify(metadata),
  };

  if (callbackUrl) {
    payload.callback_url = callbackUrl;
  }

  return paystackRequest("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

/**
 * Verify a Paystack transaction using its reference.
 */
const verifyTransaction = async (reference) => {
  if (!reference) {
    throw new AppError("Paystack transaction reference is required.", 400);
  }

  return paystackRequest(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: "GET",
    },
  );
};

module.exports = {
  amountToSubunit,
  initializeTransaction,
  verifyTransaction,
};
