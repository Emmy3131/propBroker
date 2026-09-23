const Deposit = require("../models/DepositModel");

const {
  verifyTransaction,
} = require("../services/providers/paystackService");

const {
  creditVerifiedDeposit,
  amountToSubunit,
} = require("../services/depositService");

const AppError = require("../utils/appError");

/**
 * Redirect the customer back to the frontend.
 */
const redirectToFrontend = ({
  status,
  reference,
  message,
}) => {
  const frontendUrl =
    process.env.PAYSTACK_FRONTEND_RETURN_URL;

  if (!frontendUrl) {
    throw new Error(
      "PAYSTACK_FRONTEND_RETURN_URL is not configured"
    );
  }

  const url = new URL(frontendUrl);

  url.searchParams.set("status", status);

  if (reference) {
    url.searchParams.set(
      "reference",
      reference
    );
  }

  if (message) {
    url.searchParams.set(
      "message",
      message
    );
  }

  return url.toString();
};

/**
 * Verify a Paystack transaction and compare it
 * against our internal deposit.
 */
const verifyDepositAgainstPaystack = async (
  deposit,
  reference
) => {
  /**
   * --------------------------------------------
   * 1. Reference must match our deposit
   * --------------------------------------------
   */
  if (deposit.reference !== reference) {
    throw new AppError(
      "Payment reference does not match the deposit.",
      400
    );
  }

  /**
   * --------------------------------------------
   * 2. Ask Paystack directly
   * --------------------------------------------
   */
  const response =
    await verifyTransaction(reference);

  const transaction = response.data;

  if (!transaction) {
    throw new AppError(
      "Paystack returned no transaction data.",
      502
    );
  }

  /**
   * --------------------------------------------
   * 3. Verify transaction reference
   * --------------------------------------------
   */
  if (
    String(transaction.reference) !==
    String(deposit.reference)
  ) {
    throw new AppError(
      "Paystack transaction reference mismatch.",
      400
    );
  }

  /**
   * --------------------------------------------
   * 4. Verify currency
   * --------------------------------------------
   */
  const verifiedCurrency =
    String(transaction.currency).toUpperCase();

  const depositCurrency =
    String(deposit.currency).toUpperCase();

  if (
    verifiedCurrency !==
    depositCurrency
  ) {
    throw new AppError(
      "Payment currency does not match the deposit.",
      400
    );
  }

  /**
   * --------------------------------------------
   * 5. Verify amount
   * --------------------------------------------
   *
   * Our amount is converted exactly into the
   * Paystack subunit.
   */
  const expectedAmount =
    amountToSubunit(deposit.amount);

  const receivedAmount =
    String(transaction.amount);

  if (
    receivedAmount !==
    expectedAmount
  ) {
    throw new AppError(
      "Payment amount does not match the deposit.",
      400
    );
  }

  return transaction;
};

/**
 * Paystack redirect callback.
 *
 * IMPORTANT:
 * This route is public.
 * Paystack does not have our JWT.
 */
exports.handlePaystackCallback = async (
  req,
  res
) => {
  try {
    const { reference } = req.query;

    /**
     * --------------------------------------------
     * 1. Reference is required
     * --------------------------------------------
     */
    if (!reference) {
      return res.redirect(
        redirectToFrontend({
          status: "error",
          message:
            "No Paystack transaction reference was provided.",
        })
      );
    }

    /**
     * --------------------------------------------
     * 2. Find our deposit
     * --------------------------------------------
     */
    const deposit = await Deposit.findOne({
      reference,
      provider: "paystack",
    });

    if (!deposit) {
      return res.redirect(
        redirectToFrontend({
          status: "error",
          reference,
          message:
            "Payment record could not be found.",
        })
      );
    }

    /**
     * --------------------------------------------
     * 3. Already successful?
     * --------------------------------------------
     *
     * This means the webhook probably processed it
     * before the customer reached the callback.
     */
    if (
      deposit.status === "successful" &&
      deposit.creditedAt
    ) {
      return res.redirect(
        redirectToFrontend({
          status: "success",
          reference,
          message:
            "Payment has already been confirmed.",
        })
      );
    }

    /**
     * --------------------------------------------
     * 4. Verify with Paystack
     * --------------------------------------------
     */
    const transaction =
      await verifyDepositAgainstPaystack(
        deposit,
        reference
      );

    /**
     * --------------------------------------------
     * 5. Handle successful payment
     * --------------------------------------------
     */
    if (transaction.status === "success") {
      await creditVerifiedDeposit({
        depositId: deposit._id,
        providerTransactionId:
          String(transaction.id),
        verificationMethod:
          "server_verification",
        providerData: {
          channel: transaction.channel,
          gatewayResponse:
            transaction.gateway_response,
          gatewayResponseCode:
            transaction.gateway_response_code,
          responseCode:
            transaction.response_code,
          paidAt: transaction.paid_at,
        },
      });

      return res.redirect(
        redirectToFrontend({
          status: "success",
          reference,
          message:
            "Payment verified successfully.",
        })
      );
    }

    /**
     * --------------------------------------------
     * 6. Payment did not succeed
     * --------------------------------------------
     */
    if (
      transaction.status === "failed" ||
      transaction.status === "abandoned"
    ) {
      deposit.status = "failed";
      deposit.failureReason =
        transaction.gateway_response ||
        `Paystack transaction status: ${transaction.status}`;

      await deposit.save();

      return res.redirect(
        redirectToFrontend({
          status: "failed",
          reference,
          message:
            "The payment was not successful.",
        })
      );
    }

    /**
     * --------------------------------------------
     * 7. Payment still processing
     * --------------------------------------------
     */
    return res.redirect(
      redirectToFrontend({
        status: "pending",
        reference,
        message:
          "Your payment is still being processed. Your wallet will be updated after confirmation.",
      })
    );
  } catch (error) {
    console.error(
      "Paystack callback error:",
      error
    );

    const reference =
      req.query?.reference || null;

    try {
      return res.redirect(
        redirectToFrontend({
          status: "error",
          reference,
          message:
            "We could not verify this payment yet. Please check your deposit history shortly.",
        })
      );
    } catch (redirectError) {
      return res.status(500).json({
        status: "error",
        message:
          "Payment callback processing failed.",
      });
    }
  }
};