const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const Wallet = require("../models/WalletModel");
const LedgerEntry = require("../models/LedgerEntryModel");
const AppError = require("../utils/appError");

/*
=====================================================
DECIMAL HELPERS
=====================================================
*/

/**
 * Convert any valid money value to Decimal.
 */
const toDecimal = (value) => {
  try {
    return new Decimal(String(value));
  } catch (error) {
    throw new AppError("Invalid monetary value.", 400);
  }
};

/**
 * Convert Decimal to MongoDB Decimal128.
 */
const toDecimal128 = (value) => {
  return mongoose.Types.Decimal128.fromString(toDecimal(value).toFixed(8));
};

/**
 * Convert MongoDB Decimal128 to Decimal.js.
 */
const fromDecimal128 = (value) => {
  if (value === undefined || value === null) {
    return new Decimal(0);
  }

  return new Decimal(value.toString());
};

/**
 * Convert Decimal128 to string for API responses.
 */
const decimalToString = (value) => {
  if (value === undefined || value === null) {
    return "0";
  }

  return value.toString();
};

/*
=====================================================
VALIDATE MONEY
=====================================================
*/

const validateAmount = (amount) => {
  if (amount === undefined || amount === null || amount === "") {
    throw new AppError("Amount is required.", 400);
  }

  const value = String(amount).trim();

  /*
  Only positive decimal numbers.

  Allowed:
  10
  10.50
  0.25

  Rejected:
  -10
  abc
  10.123456789
  */

  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new AppError("Invalid monetary amount.", 400);
  }

  const decimalPlaces = value.includes(".") ? value.split(".")[1].length : 0;

  if (decimalPlaces > 8) {
    throw new AppError(
      "Amount cannot contain more than 8 decimal places.",
      400,
    );
  }

  const decimalValue = new Decimal(value);

  if (!decimalValue.isFinite() || decimalValue.lte(0)) {
    throw new AppError("Amount must be greater than zero.", 400);
  }

  return decimalValue;
};

/*
=====================================================
VALIDATE LEDGER TYPE
=====================================================
*/

const allowedLedgerTypes = [
  "DEPOSIT",
  "WITHDRAWAL",
  "TRADE",
  "FEE",
  "REFUND",
  "BONUS",
  "ADJUSTMENT",
  "TRANSFER",
];

const validateLedgerType = (type) => {
  if (!type) {
    throw new AppError("Ledger transaction type is required.", 400);
  }

  const normalizedType = String(type).toUpperCase();

  if (!allowedLedgerTypes.includes(normalizedType)) {
    throw new AppError(
      `Invalid ledger transaction type: ${normalizedType}`,
      400,
    );
  }

  return normalizedType;
};

/*
=====================================================
LOAD ACTIVE WALLET
=====================================================
*/

const getActiveWallet = async (userId, session) => {
  if (!userId) {
    throw new AppError("User ID is required.", 400);
  }

  const wallet = await Wallet.findOne({
    user: userId,
  }).session(session);

  if (!wallet) {
    throw new AppError("Wallet not found.", 404);
  }

  /*
  ---------------------------------------------------
  FROZEN WALLET
  ---------------------------------------------------
  */

  if (wallet.status === "frozen") {
    throw new AppError("Your wallet is currently frozen.", 403);
  }

  /*
  ---------------------------------------------------
  CLOSED WALLET
  ---------------------------------------------------
  */

  if (wallet.status === "closed") {
    throw new AppError("Your wallet is closed.", 403);
  }

  if (wallet.status !== "active") {
    throw new AppError("Wallet is not active.", 403);
  }

  return wallet;
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
      400,
    );
  }

  const existingWallet = await Wallet.findOne({
    user: userId,
  });

  if (existingWallet) {
    return existingWallet;
  }

  return Wallet.create({
    user: userId,
    currency: normalizedCurrency,
    availableBalance: toDecimal128("0"),
    lockedBalance: toDecimal128("0"),
    status: "active",
  });
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
CREATE LEDGER ENTRY
=====================================================
*/

const createLedgerEntry = async ({
  wallet,
  userId,
  type,
  direction,
  amount,
  balanceAfter,
  reference = null,
  description = null,
  metadata = {},
  session,
}) => {
  const [entry] = await LedgerEntry.create(
    [
      {
        wallet: wallet._id,
        user: userId,
        type,
        direction,
        amount: toDecimal128(amount),
        currency: wallet.currency,
        balanceAfter: toDecimal128(balanceAfter),
        reference,
        description,
        metadata,
      },
    ],
    {
      session,
    },
  );

  return entry;
};

/*
=====================================================
CREDIT WALLET
=====================================================

Examples:

DEPOSIT
BONUS
REFUND
TRANSFER
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

  const ledgerType = validateLedgerType(type);

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const wallet = await getActiveWallet(userId, session);

      const currentBalance = fromDecimal128(wallet.availableBalance);

      const newBalance = currentBalance.plus(validatedAmount);

      wallet.availableBalance = toDecimal128(newBalance);

      wallet.lastTransactionAt = new Date();

      await wallet.save({
        session,
      });

      const ledgerEntry = await createLedgerEntry({
        wallet,
        userId,
        type: ledgerType,
        direction: "CREDIT",
        amount: validatedAmount,
        balanceAfter: newBalance,
        reference,
        description,
        metadata,
        session,
      });

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

Examples:

WITHDRAWAL
TRADE
FEE
TRANSFER
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

  const ledgerType = validateLedgerType(type);

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const wallet = await getActiveWallet(userId, session);

      const currentBalance = fromDecimal128(wallet.availableBalance);

      if (currentBalance.lt(validatedAmount)) {
        throw new AppError("Insufficient available wallet balance.", 400);
      }

      const newBalance = currentBalance.minus(validatedAmount);

      wallet.availableBalance = toDecimal128(newBalance);

      wallet.lastTransactionAt = new Date();

      await wallet.save({
        session,
      });

      const ledgerEntry = await createLedgerEntry({
        wallet,
        userId,
        type: ledgerType,
        direction: "DEBIT",
        amount: validatedAmount,
        balanceAfter: newBalance,
        reference,
        description,
        metadata,
        session,
      });

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
RESERVE WALLET FUNDS
=====================================================

Moves money:

AVAILABLE
   ↓
LOCKED

Examples:

- Pending withdrawal
- Trading order margin
- Other financial reservation
=====================================================
*/

const reserveWalletFunds = async ({
  userId,
  amount,
  type = "TRADE",
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);

  const ledgerType = validateLedgerType(type);

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const wallet = await getActiveWallet(userId, session);

      const available = fromDecimal128(wallet.availableBalance);

      const locked = fromDecimal128(wallet.lockedBalance);

      if (available.lt(validatedAmount)) {
        throw new AppError("Insufficient available wallet balance.", 400);
      }

      const newAvailable = available.minus(validatedAmount);

      const newLocked = locked.plus(validatedAmount);

      wallet.availableBalance = toDecimal128(newAvailable);

      wallet.lockedBalance = toDecimal128(newLocked);

      wallet.lastTransactionAt = new Date();

      await wallet.save({
        session,
      });

      /*
      -------------------------------------------------
      IMPORTANT
      -------------------------------------------------

      A reservation itself does not represent money
      entering or leaving the wallet.

      Therefore we do NOT create a normal CREDIT/DEBIT
      ledger entry here.

      The reservation can later be represented by
      a dedicated financial event/reservation model.
      -------------------------------------------------
      */

      result = {
        wallet,
        availableBalance: newAvailable.toFixed(8),
        lockedBalance: newLocked.toFixed(8),
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
};

/*
=====================================================
RELEASE RESERVED FUNDS
=====================================================

Moves:

LOCKED
   ↓
AVAILABLE

Example:

A withdrawal is cancelled.
=====================================================
*/

const releaseReservedFunds = async ({
  userId,
  amount,
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const wallet = await getActiveWallet(userId, session);

      const available = fromDecimal128(wallet.availableBalance);

      const locked = fromDecimal128(wallet.lockedBalance);

      if (locked.lt(validatedAmount)) {
        throw new AppError("Reserved wallet balance is insufficient.", 400);
      }

      const newAvailable = available.plus(validatedAmount);

      const newLocked = locked.minus(validatedAmount);

      wallet.availableBalance = toDecimal128(newAvailable);

      wallet.lockedBalance = toDecimal128(newLocked);

      wallet.lastTransactionAt = new Date();

      await wallet.save({
        session,
      });

      result = {
        wallet,
        availableBalance: newAvailable.toFixed(8),
        lockedBalance: newLocked.toFixed(8),
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
};

/*
=====================================================
CONSUME RESERVED FUNDS
=====================================================

Moves:

LOCKED
   ↓
REMOVED

Used when reserved money is actually spent.

Example:

A trade uses reserved margin.

This function creates a DEBIT ledger entry.
=====================================================
*/

const consumeReservedFunds = async ({
  userId,
  amount,
  type = "TRADE",
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);

  const ledgerType = validateLedgerType(type);

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const wallet = await getActiveWallet(userId, session);

      const locked = fromDecimal128(wallet.lockedBalance);

      if (locked.lt(validatedAmount)) {
        throw new AppError("Reserved wallet balance is insufficient.", 400);
      }

      const newLocked = locked.minus(validatedAmount);

      wallet.lockedBalance = toDecimal128(newLocked);

      wallet.lastTransactionAt = new Date();

      await wallet.save({
        session,
      });

      /*
      -------------------------------------------------
      BALANCE AFTER

      The available balance did not change.

      The money was already removed from available
      balance when it was reserved.

      The ledger therefore records the current
      available balance.
      -------------------------------------------------
      */

      const ledgerEntry = await createLedgerEntry({
        wallet,
        userId,
        type: ledgerType,
        direction: "DEBIT",
        amount: validatedAmount,
        balanceAfter: fromDecimal128(wallet.availableBalance),
        reference,
        description,
        metadata,
        session,
      });

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
  reserveWalletFunds,
  releaseReservedFunds,
  consumeReservedFunds,
  decimalToString,
};
