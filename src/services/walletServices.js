const mongoose = require("mongoose");

const Wallet = require("./../models/WalletModel");
const LedgerEntry = require("./../models/LedgerEntryModel");
const AppError = require("./../utils/appError");

/*
=====================================================
DECIMAL128 HELPERS
=====================================================
*/

const decimal = (value) => {
  return mongoose.Types.Decimal128.fromString(String(value));
};

const decimalToString = (value) => {
  if (value === undefined || value === null) {
    return "0";
  }

  return value.toString();
};

/*
=====================================================
VALIDATE MONEY AMOUNT
=====================================================
*/

const validateAmount = (amount) => {
  if (amount === undefined || amount === null || amount === "") {
    throw new AppError("Amount is required.", 400);
  }

  const amountString = String(amount).trim();

  if (!/^\d+(\.\d+)?$/.test(amountString)) {
    throw new AppError("Invalid monetary amount.", 400);
  }

  const value = Number(amountString);

  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError("Amount must be greater than zero.", 400);
  }

  const decimalPlaces = amountString.includes(".")
    ? amountString.split(".")[1].length
    : 0;

  if (decimalPlaces > 8) {
    throw new AppError(
      "Amount cannot contain more than 8 decimal places.",
      400
    );
  }

  return amountString;
};

/*
=====================================================
CREATE WALLET
=====================================================
*/

const createWalletForUser = async (userId, currency = "USD") => {
  if (!userId) {
    throw new AppError("User ID is required to create a wallet.", 400);
  }

  const normalizedCurrency = String(currency).toUpperCase();

  const allowedCurrencies = ["USD", "NGN", "CAD", "EUR"];

  if (!allowedCurrencies.includes(normalizedCurrency)) {
    throw new AppError(
      `Unsupported wallet currency: ${normalizedCurrency}`,
      400
    );
  }

  /*
  ---------------------------------------------------
  Check whether the user already has a wallet.
  ---------------------------------------------------
  */

  const existingWallet = await Wallet.findOne({
    user: userId,
  });

  if (existingWallet) {
    return existingWallet;
  }

  /*
  ---------------------------------------------------
  Create a new wallet.
  ---------------------------------------------------
  */

  const wallet = await Wallet.create({
    user: userId,
    currency: normalizedCurrency,
    availableBalance: decimal("0"),
    lockedBalance: decimal("0"),
    status: "active",
  });

  return wallet;
};

/*
=====================================================
GET WALLET
=====================================================
*/

const getWalletForUser = async (userId) => {
  if (!userId) {
    throw new AppError("User ID is required.", 400);
  }

  return Wallet.findOne({
    user: userId,
  });
};

/*
=====================================================
CREDIT WALLET
=====================================================

Used for:

DEPOSIT
BONUS
REFUND
TRANSFER
etc.
=====================================================
*/

const creditWallet = async ({
  userId,
  amount,
  type,
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);

  if (!type) {
    throw new AppError("Ledger transaction type is required.", 400);
  }

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const wallet = await Wallet.findOne({
        user: userId,
        status: "active",
      }).session(session);

      if (!wallet) {
        throw new AppError("Active wallet not found.", 404);
      }

      const currentBalance = decimalToString(
        wallet.availableBalance
      );

      /*
      -------------------------------------------------
      NOTE:
      This arithmetic is still Number-based.
      Replace with exact decimal arithmetic before
      processing real money.
      -------------------------------------------------
      */

      const newBalance = decimal(
        (
          Number(currentBalance) +
          Number(validatedAmount)
        ).toFixed(8)
      );

      wallet.availableBalance = newBalance;
      wallet.lastTransactionAt = new Date();

      await wallet.save({ session });

      const [ledgerEntry] = await LedgerEntry.create(
        [
          {
            wallet: wallet._id,
            user: userId,
            type,
            direction: "CREDIT",
            amount: decimal(validatedAmount),
            currency: wallet.currency,
            balanceAfter: newBalance,
            reference,
            description,
            metadata,
          },
        ],
        { session }
      );

      result = {
        wallet,
        ledgerEntry,
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
};

/*
=====================================================
DEBIT WALLET
=====================================================

Used for:

WITHDRAWAL
TRADE
FEE
TRANSFER
etc.
=====================================================
*/

const debitWallet = async ({
  userId,
  amount,
  type,
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);

  if (!type) {
    throw new AppError("Ledger transaction type is required.", 400);
  }

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const wallet = await Wallet.findOne({
        user: userId,
        status: "active",
      }).session(session);

      if (!wallet) {
        throw new AppError("Active wallet not found.", 404);
      }

      const currentBalance = Number(
        decimalToString(wallet.availableBalance)
      );

      const debitAmount = Number(validatedAmount);

      if (currentBalance < debitAmount) {
        throw new AppError(
          "Insufficient available wallet balance.",
          400
        );
      }

      const newBalance = decimal(
        (currentBalance - debitAmount).toFixed(8)
      );

      wallet.availableBalance = newBalance;
      wallet.lastTransactionAt = new Date();

      await wallet.save({ session });

      const [ledgerEntry] = await LedgerEntry.create(
        [
          {
            wallet: wallet._id,
            user: userId,
            type,
            direction: "DEBIT",
            amount: decimal(validatedAmount),
            currency: wallet.currency,
            balanceAfter: newBalance,
            reference,
            description,
            metadata,
          },
        ],
        { session }
      );

      result = {
        wallet,
        ledgerEntry,
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
};

/*
=====================================================
EXPORTS
=====================================================
*/

module.exports = {
  createWalletForUser,
  getWalletForUser,
  creditWallet,
  debitWallet,
  decimalToString,
};
