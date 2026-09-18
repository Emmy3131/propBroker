const mongoose = require("mongoose");

const Wallet = require("../models/WalletModel");
const LedgerEntry = require("../models/LedgerEntryModel");
const AppError = require("../utils/appError");

/*
=====================================================
CONVERT VALUE TO DECIMAL128
=====================================================
*/
const decimal = (value) => {
  return mongoose.Types.Decimal128.fromString(String(value));
};

/*
=====================================================
CONVERT DECIMAL128 TO NUMBER
=====================================================

Use this only when returning values to the client.

Internal financial calculations should preferably
remain Decimal128/string based.
=====================================================
*/
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
  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError("Amount must be greater than zero.", 400);
  }

  /*
   * Prevent excessive decimal precision.
   */
  const decimalPlaces = String(amount).includes(".")
    ? String(amount).split(".")[1].length
    : 0;

  if (decimalPlaces > 8) {
    throw new AppError(
      "Amount cannot contain more than 8 decimal places.",
      400,
    );
  }

  return String(amount);
};

/*
=====================================================
CREATE WALLET
=====================================================
*/
const createWalletForUser = async (userId, currency = "USD") => {
  const existingWallet = await Wallet.findOne({
    user: userId,
  });

  if (existingWallet) {
    return existingWallet;
  }

  return Wallet.create({
    user: userId,
    currency,
    availableBalance: decimal("0"),
    lockedBalance: decimal("0"),
  });
};

/*
=====================================================
GET WALLET
=====================================================
*/
const getWalletForUser = async (userId) => {
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

      const currentBalance = decimalToString(wallet.availableBalance);

      const newBalance = decimal(
        (Number(currentBalance) + Number(validatedAmount)).toFixed(8),
      );

      wallet.availableBalance = newBalance;

      wallet.lastTransactionAt = new Date();

      await wallet.save({
        session,
      });

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
        { session },
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

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      /*
       * IMPORTANT:
       *
       * The wallet is read inside the transaction.
       * We then check the available balance before
       * performing the debit.
       */
      const wallet = await Wallet.findOne({
        user: userId,
        status: "active",
      }).session(session);

      if (!wallet) {
        throw new AppError("Active wallet not found.", 404);
      }

      const currentBalance = Number(decimalToString(wallet.availableBalance));

      const debitAmount = Number(validatedAmount);

      if (currentBalance < debitAmount) {
        throw new AppError("Insufficient available wallet balance.", 400);
      }

      const newBalance = decimal((currentBalance - debitAmount).toFixed(8));

      wallet.availableBalance = newBalance;

      wallet.lastTransactionAt = new Date();

      await wallet.save({
        session,
      });

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
        { session },
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

module.exports = {
  createWalletForUser,
  getWalletForUser,
  creditWallet,
  debitWallet,
  decimalToString,
};
