const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const Wallet = require("../models/WalletModel");
const LedgerEntry = require("../models/LedgerEntryModel");
const AppError = require("../utils/appError");

/*
=====================================================
SUPPORTED WALLET CURRENCIES
=====================================================
*/

const SUPPORTED_CURRENCIES = ["USD", "NGN", "CAD", "EUR"];

/*
=====================================================
NORMALIZE CURRENCY
=====================================================
*/

const normalizeCurrency = (currency = "USD") => {
  const normalized = String(currency).trim().toUpperCase();

  if (!SUPPORTED_CURRENCIES.includes(normalized)) {
    throw new AppError(`Unsupported wallet currency: ${normalized}`, 400);
  }

  return normalized;
};

/*
=====================================================
DECIMAL HELPERS
=====================================================
*/

/**
 * Convert any valid money value to Decimal.js.
 */
const toDecimal = (value) => {
  try {
    const decimal = new Decimal(String(value));

    if (!decimal.isFinite()) {
      throw new Error("Invalid decimal");
    }

    return decimal;
  } catch (error) {
    throw new AppError("Invalid monetary value.", 400);
  }
};

/**
 * Convert Decimal.js to MongoDB Decimal128.
 *
 * Wallet balances are stored with 8 decimal places.
 */
const toDecimal128 = (value) => {
  const decimal = toDecimal(value);

  return mongoose.Types.Decimal128.fromString(decimal.toFixed(8));
};

/**
 * Convert MongoDB Decimal128 to Decimal.js.
 */
const fromDecimal128 = (value) => {
  if (value === undefined || value === null) {
    return new Decimal(0);
  }

  try {
    return new Decimal(value.toString());
  } catch (error) {
    throw new AppError("Invalid stored monetary value.", 500);
  }
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
VALIDATE MONEY AMOUNT
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
  1,000
  $100
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

  const normalizedType = String(type).trim().toUpperCase();

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
GET ACTIVE WALLET
=====================================================

A user can have:

USER + USD
USER + NGN
USER + CAD
USER + EUR

Therefore currency is always part of the lookup.
=====================================================
*/

const getActiveWallet = async (userId, currency = "USD", session = null) => {
  if (!userId) {
    throw new AppError("User ID is required.", 400);
  }

  const normalizedCurrency = normalizeCurrency(currency);

  const query = Wallet.findOne({
    user: userId,
    currency: normalizedCurrency,
  });

  if (session) {
    query.session(session);
  }

  const wallet = await query;

  if (!wallet) {
    throw new AppError(`${normalizedCurrency} wallet not found.`, 404);
  }

  if (wallet.status === "frozen") {
    throw new AppError(
      `Your ${normalizedCurrency} wallet is currently frozen.`,
      403,
    );
  }

  if (wallet.status === "closed") {
    throw new AppError(`Your ${normalizedCurrency} wallet is closed.`, 403);
  }

  if (wallet.status !== "active") {
    throw new AppError(`${normalizedCurrency} wallet is not active.`, 403);
  }

  return wallet;
};

/*
=====================================================
CREATE WALLET FOR USER
=====================================================

Creates one wallet for:

USER + CURRENCY

Example:

User A + USD
User A + NGN
User A + CAD
User A + EUR

=====================================================
*/

const createWalletForUser = async (userId, currency = "USD") => {
  if (!userId) {
    throw new AppError("User ID is required to create a wallet.", 400);
  }

  const normalizedCurrency = normalizeCurrency(currency);

  /*
  Check whether this specific currency wallet
  already exists.
  */

  const existingWallet = await Wallet.findOne({
    user: userId,
    currency: normalizedCurrency,
  });

  if (existingWallet) {
    return existingWallet;
  }

  try {
    const wallet = await Wallet.create({
      user: userId,
      currency: normalizedCurrency,
      availableBalance: toDecimal128("0"),
      lockedBalance: toDecimal128("0"),
      status: "active",
    });

    return wallet;
  } catch (error) {
    /*
    -------------------------------------------------
    DUPLICATE WALLET RACE CONDITION
    -------------------------------------------------

    Two requests may attempt to create the same wallet
    at exactly the same time.

    The unique compound index:

    user + currency

    protects against this.
    */

    if (error.code === 11000) {
      const wallet = await Wallet.findOne({
        user: userId,
        currency: normalizedCurrency,
      });

      if (wallet) {
        return wallet;
      }
    }

    throw error;
  }
};

/*
=====================================================
CREATE DEFAULT WALLETS
=====================================================

Creates:

USD
NGN
CAD
EUR

for the user.

This can be called after signup.

=====================================================
*/

const createDefaultWalletsForUser = async (userId) => {
  if (!userId) {
    throw new AppError("User ID is required.", 400);
  }

  const wallets = [];

  for (const currency of SUPPORTED_CURRENCIES) {
    const wallet = await createWalletForUser(userId, currency);

    wallets.push(wallet);
  }

  return wallets;
};

/*
=====================================================
GET WALLET FOR USER
=====================================================

If currency is supplied:

    returns ONE wallet.

Example:
getWalletForUser(userId, "NGN")

If currency is not supplied:

    returns ALL wallets.

Example:
getWalletForUser(userId)

=====================================================
*/

const getWalletForUser = async (userId, currency = null) => {
  if (!userId) {
    throw new AppError("User ID is required.", 400);
  }

  /*
  -------------------------------------------------
  SPECIFIC CURRENCY
  -------------------------------------------------
  */

  if (currency) {
    const normalizedCurrency = normalizeCurrency(currency);

    return Wallet.findOne({
      user: userId,
      currency: normalizedCurrency,
    });
  }

  /*
  -------------------------------------------------
  ALL CURRENCY WALLETS
  -------------------------------------------------
  */

  return Wallet.find({
    user: userId,
  }).sort({
    currency: 1,
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
  session = null,
}) => {
  if (!wallet) {
    throw new AppError("Wallet is required to create a ledger entry.", 500);
  }

  const entryData = {
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
  };

  /*
  Use create with session when inside a transaction.
  */

  if (session) {
    const [entry] = await LedgerEntry.create([entryData], {
      session,
    });

    return entry;
  }

  return LedgerEntry.create(entryData);
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
  currency = "USD",
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);

  const ledgerType = validateLedgerType(type);

  const normalizedCurrency = normalizeCurrency(currency);

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const wallet = await getActiveWallet(userId, normalizedCurrency, session);

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
  currency = "USD",
  type,
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);

  const ledgerType = validateLedgerType(type);

  const normalizedCurrency = normalizeCurrency(currency);

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const wallet = await getActiveWallet(userId, normalizedCurrency, session);

      const currentBalance = fromDecimal128(wallet.availableBalance);

      /*
        -------------------------------------------------
        INSUFFICIENT BALANCE
        -------------------------------------------------
        */

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

Moves:

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
  currency = "USD",
  type = "TRADE",
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);

  /*
  Validate type even though no ledger entry
  is currently created.
  */

  validateLedgerType(type);

  const normalizedCurrency = normalizeCurrency(currency);

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const wallet = await getActiveWallet(userId, normalizedCurrency, session);

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

        Reservation does not create or destroy money.

        It only moves money:

        AVAILABLE → LOCKED

        Therefore no normal CREDIT/DEBIT ledger
        entry is created here.

        reference, description and metadata are retained
        in the function interface so the caller can use
        them when a dedicated reservation model is added.
        -------------------------------------------------
        */

      result = {
        wallet,
        availableBalance: newAvailable.toFixed(8),
        lockedBalance: newLocked.toFixed(8),
        currency: wallet.currency,
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
  currency = "USD",
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);

  const normalizedCurrency = normalizeCurrency(currency);

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const wallet = await getActiveWallet(userId, normalizedCurrency, session);

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
        currency: wallet.currency,
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

This creates a DEBIT ledger entry.

=====================================================
*/

const consumeReservedFunds = async ({
  userId,
  amount,
  currency = "USD",
  type = "TRADE",
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);

  const ledgerType = validateLedgerType(type);

  const normalizedCurrency = normalizeCurrency(currency);

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const wallet = await getActiveWallet(userId, normalizedCurrency, session);

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
        -------------------------------------------------

        The available balance does not change here.

        The money was already removed from available
        balance when it was reserved.

        Therefore the ledger's balanceAfter represents
        the current available balance.
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
  createDefaultWalletsForUser,
  getWalletForUser,

  creditWallet,
  debitWallet,

  reserveWalletFunds,
  releaseReservedFunds,
  consumeReservedFunds,

  decimalToString,
};
