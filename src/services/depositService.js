const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const Deposit = require("../models/DepositModel");
const Wallet = require("../models/WalletModel");
const LedgerEntry = require("../models/LedgerEntryModel");

const AppError = require("../utils/appError");

/**
 * Convert a MongoDB Decimal128 value to Decimal.js.
 */
const toDecimal = (value) => {
  return new Decimal(String(value ?? "0"));
};

/**
 * Convert Decimal.js to MongoDB Decimal128.
 *
 * We keep 8 decimal places internally.
 */
const toDecimal128 = (value) => {
  return mongoose.Types.Decimal128.fromString(toDecimal(value).toFixed(8));
};

/**
 * Convert a Decimal128 value to string.
 */
const decimalToString = (value) => {
  if (value === null || value === undefined) {
    return "0";
  }

  return value.toString();
};

/**
 * Convert our wallet amount into the smallest Paystack
 * currency unit.
 *
 * Example:
 *
 * NGN 100.00 -> 10000
 * USD 100.00 -> 10000
 *
 * Paystack's transaction verification response reports
 * the transaction amount in the currency's subunit.
 */
const amountToSubunit = (amount) => {
  const decimalAmount = toDecimal(amount);

  if (!decimalAmount.isFinite()) {
    throw new AppError("Invalid financial amount.", 400);
  }

  if (decimalAmount.lte(0)) {
    throw new AppError("Financial amount must be greater than zero.", 400);
  }

  /**
   * Paystack currently uses 2-decimal subunits for
   * the currencies we are integrating here.
   */
  const subunit = decimalAmount.mul(100);

  if (!subunit.isInteger()) {
    throw new AppError(
      "Amount cannot contain more than 2 decimal places for Paystack.",
      400,
    );
  }

  return subunit.toFixed(0);
};

/**
 * Validate a financial amount.
 */
const validateAmount = (amount) => {
  if (amount === undefined || amount === null || amount === "") {
    throw new AppError("Amount is required.", 400);
  }

  const value = toDecimal(amount);

  if (!value.isFinite()) {
    throw new AppError("Invalid amount.", 400);
  }

  if (value.lte(0)) {
    throw new AppError("Amount must be greater than zero.", 400);
  }

  return value;
};

/**
 * Credit a verified deposit.
 *
 * IMPORTANT:
 * This function must only be called after the payment
 * provider has independently verified the transaction.
 */
const creditVerifiedDeposit = async ({
  depositId,
  providerTransactionId,
  verificationMethod = "webhook",
  providerData = null,
}) => {
  if (!depositId) {
    throw new AppError("Deposit ID is required.", 400);
  }

  if (!providerTransactionId) {
    throw new AppError("Provider transaction ID is required.", 400);
  }

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      /**
       * ------------------------------------------------
       * 1. Load the deposit
       * ------------------------------------------------
       */
      const deposit = await Deposit.findById(depositId)
        .session(session)
        .select("+providerData");

      if (!deposit) {
        throw new AppError("Deposit not found.", 404);
      }

      /**
       * ------------------------------------------------
       * 2. Already processed?
       * ------------------------------------------------
       *
       * This is our first idempotency protection.
       */
      if (deposit.status === "successful" && deposit.creditedAt) {
        result = {
          alreadyProcessed: true,
          deposit,
        };

        return;
      }

      /**
       * ------------------------------------------------
       * 3. Only process Paystack deposits
       * ------------------------------------------------
       */
      if (deposit.provider !== "paystack") {
        throw new AppError("Unsupported payment provider.", 400);
      }

      /**
       * ------------------------------------------------
       * 4. Validate provider transaction ID
       * ------------------------------------------------
       */
      if (
        deposit.providerTransactionId &&
        String(deposit.providerTransactionId) !== String(providerTransactionId)
      ) {
        throw new AppError(
          "Provider transaction ID does not match this deposit.",
          400,
        );
      }

      /**
       * ------------------------------------------------
       * 5. Load wallet
       * ------------------------------------------------
       */
      const wallet = await Wallet.findOne({
        _id: deposit.wallet,
        user: deposit.user,
      }).session(session);

      if (!wallet) {
        throw new AppError(
          "Wallet associated with this deposit was not found.",
          404,
        );
      }

      /**
       * ------------------------------------------------
       * 6. Make sure wallet can receive funds
       * ------------------------------------------------
       */
      if (wallet.status !== "active") {
        throw new AppError(`Wallet is currently ${wallet.status}.`, 403);
      }

      /**
       * ------------------------------------------------
       * 7. Validate deposit amount
       * ------------------------------------------------
       */
      const depositAmount = validateAmount(deposit.amount);

      /**
       * ------------------------------------------------
       * 8. Calculate exact new balance
       * ------------------------------------------------
       */
      const currentBalance = toDecimal(wallet.availableBalance);

      const newBalance = currentBalance.plus(depositAmount);

      /**
       * ------------------------------------------------
       * 9. Update wallet
       * ------------------------------------------------
       */
      wallet.availableBalance = toDecimal128(newBalance);

      wallet.lastTransactionAt = new Date();

      await wallet.save({
        session,
      });

      /**
       * ------------------------------------------------
       * 10. Create immutable ledger entry
       * ------------------------------------------------
       */
      const ledgerEntry = await LedgerEntry.create(
        [
          {
            wallet: wallet._id,
            user: deposit.user,

            type: "DEPOSIT",
            direction: "CREDIT",

            amount: toDecimal128(depositAmount),

            currency: deposit.currency,

            balanceAfter: toDecimal128(newBalance),

            reference: deposit.reference,

            description: "Wallet credited from verified Paystack deposit.",

            metadata: {
              provider: "paystack",
              providerTransactionId: String(providerTransactionId),
              verificationMethod,
              depositId: deposit._id.toString(),
            },
          },
        ],
        {
          session,
        },
      );

      /**
       * ------------------------------------------------
       * 11. Mark deposit successful
       * ------------------------------------------------
       */
      deposit.status = "successful";

      deposit.providerTransactionId = String(providerTransactionId);

      deposit.providerReference =
        deposit.providerReference || deposit.reference;

      deposit.verifiedAt = new Date();

      deposit.verificationMethod = verificationMethod;

      deposit.creditedAt = new Date();

      deposit.ledgerEntry = ledgerEntry[0]._id;

      if (providerData) {
        deposit.providerData = providerData;
      }

      deposit.failureReason = null;

      await deposit.save({
        session,
      });

      /**
       * ------------------------------------------------
       * 12. Return successful result
       * ------------------------------------------------
       */
      result = {
        alreadyProcessed: false,
        deposit,
        wallet,
        ledgerEntry: ledgerEntry[0],
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  creditVerifiedDeposit,
  amountToSubunit,
  decimalToString,
};
