const crypto = require("crypto");

const AppError = require("../../../utils/appError");

const RAPYD_BASE_URL =
  process.env.RAPYD_BASE_URL || "https://sandboxapi.rapyd.net";

const getCredentials = () => {
  const accessKey = process.env.RAPYD_ACCESS_KEY;
  const secretKey = process.env.RAPYD_SECRET_KEY;

  if (!accessKey) {
    throw new AppError("RAPYD_ACCESS_KEY is not configured.", 500);
  }

  if (!secretKey) {
    throw new AppError("RAPYD_SECRET_KEY is not configured.", 500);
  }

  return {
    accessKey,
    secretKey,
  };
};

/*
=====================================================
GENERATE RAPYD SIGNATURE
=====================================================
*/

const generateSignature = ({
  method,
  path,
  body,
  salt,
  timestamp,
  secretKey,
}) => {
  const bodyString = body || "";

  const toSign =
    `${method.toLowerCase()}` +
    `|${path}` +
    `|${salt}` +
    `|${timestamp}` +
    `|${secretKey}` +
    `|${bodyString}`;

  return crypto.createHmac("sha256", secretKey).update(toSign).digest("hex");
};

/*
=====================================================
RAPYD REQUEST
=====================================================
*/

const rapydRequest = async ({ method = "GET", path, body = null }) => {
  const { accessKey, secretKey } = getCredentials();

  const salt = crypto.randomBytes(16).toString("hex");

  const timestamp = Math.floor(Date.now() / 1000);

  const bodyString = body ? JSON.stringify(body) : "";

  const signature = generateSignature({
    method,
    path,
    body: bodyString,
    salt,
    timestamp,
    secretKey,
  });

  const headers = {
    access_key: accessKey,
    salt,
    timestamp: String(timestamp),
    signature,
    "Content-Type": "application/json",
  };

  let response;

  try {
    response = await fetch(`${RAPYD_BASE_URL}${path}`, {
      method,
      headers,
      body: bodyString || undefined,
    });
  } catch (error) {
    throw new AppError(`Unable to connect to Rapyd: ${error.message}`, 502);
  }

  let data;

  try {
    data = await response.json();
  } catch (error) {
    throw new AppError("Rapyd returned an invalid response.", 502);
  }

  if (!response.ok) {
    throw new AppError(
      data?.status?.message || data?.message || "Rapyd API request failed.",
      response.status || 502,
    );
  }

  if (data?.status?.error_code) {
    throw new AppError(
      data.status.message || "Rapyd API returned an error.",
      502,
    );
  }

  return data;
};

/*
=====================================================
CREATE CHECKOUT
=====================================================
*/

const createCheckout = async ({
  amount,
  country,
  currency,
  requestedCurrency,
  merchantReferenceId,
  completeCheckoutUrl,
  cancelCheckoutUrl,
}) => {
  if (!amount) {
    throw new AppError("Payment amount is required.", 400);
  }

  if (!country) {
    throw new AppError("Customer country is required.", 400);
  }

  if (!currency) {
    throw new AppError("Payment currency is required.", 400);
  }

  const body = {
    amount,
    country: country.toUpperCase(),
    currency: currency.toUpperCase(),
    requested_currency: (requestedCurrency || currency).toUpperCase(),

    merchant_reference_id: merchantReferenceId,

    complete_checkout_url: completeCheckoutUrl,

    cancel_checkout_url: cancelCheckoutUrl,
  };

  return rapydRequest({
    method: "POST",
    path: "/v1/checkout",
    body,
  });
};

/*
=====================================================
GET PAYMENT
=====================================================
*/

const getPayment = async (paymentId) => {
  if (!paymentId) {
    throw new AppError("Rapyd payment ID is required.", 400);
  }

  return rapydRequest({
    method: "GET",
    path: `/v1/payments/${encodeURIComponent(paymentId)}`,
  });
};

module.exports = {
  createCheckout,
  getPayment,
};
