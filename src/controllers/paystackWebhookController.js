const crypto = require("crypto");

const Deposit = require("../models/DepositModel");
const { verifyTransaction } = require("../services/providers/paystackService");
const {
  creditVerifiedDeposit,
  amountToSubunit,
} = require("../services/depositService");

/**
 * Compare Paystack's HMAC signature safely.
 */
const isValidPaystackSignature = (req) => {
  const signature = req.get("x-paystack-signature");

  if (!signature) {
    return false;
  }

  if (!req.rawBody) {
    return false;
  }

  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured");
  }

  const expectedSignature = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(req.rawBody)
    .digest("hex");

  const receivedBuffer = Buffer.from(signature, "utf8");

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
};

/**
 * Paystack webhook.
 */
exports.handlePaystackWebhook = async (req, res, next) => {
  try {
    /**
     * --------------------------------------------
     * 1. Verify webhook signature
     * --------------------------------------------
     */
    const validSignature = isValidPaystackSignature(req);

    if (!validSignature) {
      return res.status(401).json({
        status: "fail",
        message: "Invalid Paystack webhook signature.",
      });
    }

    const event = req.body;

    /**
     * --------------------------------------------
     * 2. Ignore events we don't process
     * --------------------------------------------
     */
    if (event.event !== "charge.success") {
      return res.status(200).json({
        status: "success",
        message: "Event received.",
      });
    }

    const webhookData = event.data;

    if (!webhookData || !webhookData.reference) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid Paystack webhook payload.",
      });
    }

    const reference = webhookData.reference;

    /**
     * --------------------------------------------
     * 3. Find our deposit
     * --------------------------------------------
     */
    const deposit = await Deposit.findOne({
      reference,
      provider: "paystack",
    });

    if (!deposit) {
      /**
       * We acknowledge the event so Paystack does
       * not repeatedly send an event for a payment
       * that does not belong to this integration.
       */
      return res.status(200).json({
        status: "success",
        message: "Deposit not found. Event acknowledged.",
      });
    }

    /**
     * --------------------------------------------
     * 4. Idempotency check
     * --------------------------------------------
     */
    if (deposit.status === "successful" && deposit.creditedAt) {
      return res.status(200).json({
        status: "success",
        message: "Deposit already processed.",
      });
    }

    /**
     * --------------------------------------------
     * 5. Verify directly with Paystack
     * --------------------------------------------
     */
    const verification = await verifyTransaction(reference);

    const verifiedTransaction = verification.data;

    /**
     * --------------------------------------------
     * 6. Confirm Paystack says success
     * --------------------------------------------
     */
    if (!verifiedTransaction || verifiedTransaction.status !== "success") {
      return res.status(200).json({
        status: "success",
        message: "Transaction is not successful.",
      });
    }

    /**
     * --------------------------------------------
     * 7. Confirm reference
     * --------------------------------------------
     */
    if (verifiedTransaction.reference !== deposit.reference) {
      return res.status(400).json({
        status: "fail",
        message: "Transaction reference mismatch.",
      });
    }

    /**
     * --------------------------------------------
     * 8. Confirm currency
     * --------------------------------------------
     */
    if (
      String(verifiedTransaction.currency).toUpperCase() !==
      String(deposit.currency).toUpperCase()
    ) {
      return res.status(400).json({
        status: "fail",
        message: "Transaction currency mismatch.",
      });
    }

    /**
     * --------------------------------------------
     * 9. Confirm amount
     *
     * Paystack amount is in subunits.
     * We compare against our own deposit amount.
     * --------------------------------------------
     */
    const expectedSubunit = amountToSubunit(deposit.amount);

    const receivedSubunit = String(verifiedTransaction.amount);
    
    if (receivedSubunit !== expectedSubunit) {
      return res
        .status(400)
        .json({ status: "fail", message: "Transaction amount mismatch." });
    }

    /**
     * --------------------------------------------
     * 10. Credit wallet exactly once
     * --------------------------------------------
     */
    await creditVerifiedDeposit({
      depositId: deposit._id,
      providerTransactionId: String(verifiedTransaction.id),
      verificationMethod: "webhook",
      providerData: {
        channel: verifiedTransaction.channel,
        gatewayResponse: verifiedTransaction.gateway_response,
        paidAt: verifiedTransaction.paid_at,
      },
    });

    /**
     * --------------------------------------------
     * 11. Acknowledge webhook
     * --------------------------------------------
     */
    return res.status(200).json({
      status: "success",
      message: "Payment processed successfully.",
    });
  } catch (error) {
    next(error);
  }
};
