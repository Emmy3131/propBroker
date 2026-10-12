const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const Wallet = require("../models/WalletModel");
const LedgerEntry = require("../models/LedgerEntryModel");
const AppError = require("../utils/appError");

const BASE_CURRENCY = "USD";
const SUPPORTED_CURRENCIES = ["USD", "NGN", "CAD", "EUR"];
const WALLET_PRECISION = 8;

const ALLOWED_LEDGER_TYPES = [
  "DEPOSIT",
  "WITHDRAWAL",
  "TRADE",
  "FEE",
  "REFUND",
  "BONUS",
  "ADJUSTMENT",
  "TRANSFER",
];

/*
=====================================================
CURRENCY HELPERS
=====================================================
*/

const normalizeCurrency = (currency = BASE_CURRENCY) => {
  const normalized = String(currency).trim().toUpperCase();

  if (!SUPPORTED_CURRENCIES.includes(normalized)) {
    throw new AppError(
      `Unsupported currency: ${normalized}. Supported currencies are USD, NGN, CAD and EUR.`,
      400,
    );
  }

  return normalized;
};

/*
=====================================================
DECIMAL HELPERS
=====================================================
*/

const toDecimal = (value) => {
  try {
    const decimal = new Decimal(String(value));

    if (!decimal.isFinite()) {
      throw new Error("Invalid decimal");
    }

    return decimal;
  } catch {
    throw new AppError("Invalid monetary value.", 400);
  }
};

const toDecimal128 = (value) => {
  const decimal = toDecimal(value);

  return mongoose.Types.Decimal128.fromString(
    decimal.toFixed(WALLET_PRECISION, Decimal.ROUND_HALF_UP),
  );
};

const fromDecimal128 = (value) => {
  if (value === undefined || value === null) {
    return new Decimal(0);
  }

  try {
    return new Decimal(value.toString());
  } catch {
    throw new AppError("Invalid stored monetary value.", 500);
  }
};

const decimalToString = (value) => {
  if (value === undefined || value === null) {
    return "0";
  }

  return value.toString();
};

const validateAmount = (amount) => {
  if (amount === undefined || amount === null || amount === "") {
    throw new AppError("Amount is required.", 400);
  }

  const value = String(amount).trim();

  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new AppError("Invalid monetary amount.", 400);
  }

  const decimalPlaces = value.includes(".") ? value.split(".")[1].length : 0;

  if (decimalPlaces > WALLET_PRECISION) {
    throw new AppError(
      `Amount cannot contain more than ${WALLET_PRECISION} decimal places.`,
      400,
    );
  }

  const decimal = new Decimal(value);

  if (!decimal.isFinite() || decimal.lte(0)) {
    throw new AppError("Amount must be greater than zero.", 400);
  }

  return decimal;
};

const validateLedgerType = (type) => {
  const normalized = String(type || "")
    .trim()
    .toUpperCase();

  if (!ALLOWED_LEDGER_TYPES.includes(normalized)) {
    throw new AppError(
      `Invalid ledger transaction type: ${normalized || "missing"}.`,
      400,
    );
  }

  return normalized;
};

/*
=====================================================
BASE CURRENCY VALIDATION
=====================================================

Wallet balances are ALWAYS USD.

NGN, CAD and EUR are display or payment currencies,
not wallet balance currencies.

Convert confirmed non-USD payments to USD in the
deposit service before calling creditWallet().
=====================================================
*/

const requireBaseCurrency = (currency = BASE_CURRENCY) => {
  const normalized = normalizeCurrency(currency);

  if (normalized !== BASE_CURRENCY) {
    throw new AppError(
      `Wallet balance operations must use ${BASE_CURRENCY}. Convert the transaction amount to USD before modifying the wallet.`,
      400,
    );
  }

  return BASE_CURRENCY;
};

/*
=====================================================
GET ACTIVE WALLET
=====================================================

Returns the user's ONE wallet.

The optional currency argument is retained for
backward compatibility, but cannot select a separate
currency wallet. Non-USD balance operations are rejected.
=====================================================
*/

const getActiveWallet = async (
  userId,
  currency = BASE_CURRENCY,
  session = null,
) => {
  if (!userId) {
    throw new AppError("User ID is required.", 400);
  }

  requireBaseCurrency(currency);

  const query = Wallet.findOne({
    user: userId,
  });

  if (session) {
    query.session(session);
  }

  const wallet = await query;

  if (!wallet) {
    throw new AppError("Your wallet was not found.", 404);
  }

  if (wallet.status !== "active") {
    if (wallet.status === "frozen") {
      throw new AppError("Your wallet is currently frozen.", 403);
    }

    if (wallet.status === "closed") {
      throw new AppError("Your wallet is closed.", 403);
    }

    throw new AppError("Your wallet is not active.", 403);
  }

  if (wallet.baseCurrency !== BASE_CURRENCY) {
    throw new AppError(
      "Wallet base currency is invalid. Please contact support.",
      500,
    );
  }

  return wallet;
};

/*
=====================================================
CREATE OR RETRIEVE ONE WALLET
=====================================================

createWalletForUser(userId, "NGN") creates a wallet
whose display currency is NGN, NOT an NGN balance.

Existing callers can continue passing a supported
currency as their second argument.
=====================================================
*/

const createWalletForUser = async (userId, displayCurrency = BASE_CURRENCY) => {
  if (!userId) {
    throw new AppError("User ID is required to create a wallet.", 400);
  }

  const normalizedDisplayCurrency = normalizeCurrency(displayCurrency);

  let wallet = await Wallet.findOne({ user: userId });

  if (wallet) {
    return wallet;
  }

  try {
    wallet = await Wallet.create({
      user: userId,
      baseCurrency: BASE_CURRENCY,
      displayCurrency: normalizedDisplayCurrency,
      availableBalance: toDecimal128("0"),
      lockedBalance: toDecimal128("0"),
      status: "active",
    });

    return wallet;
  } catch (error) {
    // Recover when concurrent requests create the same wallet.
    if (error.code === 11000) {
      wallet = await Wallet.findOne({ user: userId });

      if (wallet) {
        return wallet;
      }
    }

    throw error;
  }
};

/*
=====================================================
CREATE DEFAULT WALLET
=====================================================

Kept under the old function name so existing signup
code does not have to change immediately.

It now creates exactly ONE USD wallet.
=====================================================
*/

const createDefaultWalletsForUser = async (userId) => {
  const wallet = await createWalletForUser(userId, BASE_CURRENCY);

  // Return an array for compatibility with older signup code.
  return [wallet];
};

/*
=====================================================
GET WALLET FOR USER
=====================================================

Always returns one wallet document or null.

The optional currency parameter is retained for
compatibility, but never selects another wallet.
=====================================================
*/

const getWalletForUser = async (userId, currency = null) => {
  if (!userId) {
    throw new AppError("User ID is required.", 400);
  }

  if (currency !== null && currency !== undefined) {
    normalizeCurrency(currency);
  }

  return Wallet.findOne({ user: userId });
};

/*
=====================================================
CREATE LEDGER ENTRY
=====================================================

The ledger records the actual wallet balance movement
in USD. Original payment and payout currencies, rates,
and external references belong in metadata or dedicated
transaction fields.
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

  if (!["CREDIT", "DEBIT"].includes(direction)) {
    throw new AppError("Invalid ledger direction.", 400);
  }

  const entryData = {
    wallet: wallet._id,
    user: userId,
    type: validateLedgerType(type),
    direction,
    amount: toDecimal128(amount),
    currency: BASE_CURRENCY,
    balanceAfter: toDecimal128(balanceAfter),
    reference,
    description,
    metadata,
  };

  if (session) {
    const [entry] = await LedgerEntry.create([entryData], { session });
    return entry;
  }

  return LedgerEntry.create(entryData);
};

/*
=====================================================
VERIFY IDEMPOTENT CREDIT
=====================================================
*/

const verifyExistingCredit = async ({ entry, userId, amount, type }) => {
  if (
    entry.direction !== "CREDIT" ||
    String(entry.user) !== String(userId) ||
    String(entry.currency).toUpperCase() !== BASE_CURRENCY ||
    entry.type !== type ||
    !fromDecimal128(entry.amount).eq(amount)
  ) {
    throw new AppError(
      "This financial reference has already been used for a different transaction.",
      409,
    );
  }

  const wallet = await Wallet.findById(entry.wallet);

  return {
    wallet,
    ledgerEntry: entry,
    alreadyProcessed: true,
  };
};

/*
=====================================================
CREDIT WALLET
=====================================================

The reference must be unique and stable across retries.

IMPORTANT:
amount is the USD amount to credit, not the original
NGN, CAD or EUR payment amount.
=====================================================
*/

const creditWallet = async ({
  userId,
  amount,
  type,
  currency = BASE_CURRENCY,
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);
  const ledgerType = validateLedgerType(type);

  requireBaseCurrency(currency);

  const normalizedReference =
    reference === null || reference === undefined
      ? ""
      : String(reference).trim();

  if (!normalizedReference) {
    throw new AppError(
      "A unique financial reference is required for wallet credit.",
      400,
    );
  }

  if (!userId) {
    throw new AppError("User ID is required.", 400);
  }

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const existingEntry = await LedgerEntry.findOne({
        reference: normalizedReference,
      }).session(session);

      if (existingEntry) {
        if (
          existingEntry.direction !== "CREDIT" ||
          String(existingEntry.user) !== String(userId) ||
          String(existingEntry.currency).toUpperCase() !== BASE_CURRENCY ||
          existingEntry.type !== ledgerType ||
          !fromDecimal128(existingEntry.amount).eq(validatedAmount)
        ) {
          throw new AppError(
            "This financial reference has already been used for a different transaction.",
            409,
          );
        }

        const existingWallet = await Wallet.findById(
          existingEntry.wallet,
        ).session(session);

        result = {
          wallet: existingWallet,
          ledgerEntry: existingEntry,
          alreadyProcessed: true,
        };

        return;
      }

      const wallet = await getActiveWallet(userId, BASE_CURRENCY, session);

      const currentBalance = fromDecimal128(wallet.availableBalance);
      const newBalance = currentBalance.plus(validatedAmount);

      wallet.availableBalance = toDecimal128(newBalance);
      wallet.lastTransactionAt = new Date();

      await wallet.save({ session });

      const ledgerEntry = await createLedgerEntry({
        wallet,
        userId,
        type: ledgerType,
        direction: "CREDIT",
        amount: validatedAmount,
        balanceAfter: newBalance,
        reference: normalizedReference,
        description,
        metadata,
        session,
      });

      result = {
        wallet,
        ledgerEntry,
        alreadyProcessed: false,
      };
    });

    return result;
  } catch (error) {
    // A unique reference index can detect a concurrent duplicate.
    if (error.code === 11000) {
      const existingEntry = await LedgerEntry.findOne({
        reference: normalizedReference,
      });

      if (existingEntry) {
        return verifyExistingCredit({
          entry: existingEntry,
          userId,
          amount: validatedAmount,
          type: ledgerType,
        });
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/*
=====================================================
DEBIT WALLET
=====================================================

All debits are denominated in USD.

Use a unique reference for every financial operation.
=====================================================
*/

const debitWallet = async ({
  userId,
  amount,
  currency = BASE_CURRENCY,
  type,
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);
  const ledgerType = validateLedgerType(type);

  requireBaseCurrency(currency);

  if (!userId) {
    throw new AppError("User ID is required.", 400);
  }

  if (!reference || !String(reference).trim()) {
    throw new AppError("A financial reference is required for debit.", 400);
  }

  const normalizedReference = String(reference).trim();
  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const existingEntry = await LedgerEntry.findOne({
        reference: normalizedReference,
      }).session(session);

      if (existingEntry) {
        if (
          existingEntry.direction !== "DEBIT" ||
          String(existingEntry.user) !== String(userId) ||
          String(existingEntry.currency).toUpperCase() !== BASE_CURRENCY ||
          existingEntry.type !== ledgerType ||
          !fromDecimal128(existingEntry.amount).eq(validatedAmount)
        ) {
          throw new AppError(
            "This financial reference has already been used for a different transaction.",
            409,
          );
        }

        result = {
          wallet: await Wallet.findById(existingEntry.wallet).session(session),
          ledgerEntry: existingEntry,
          alreadyProcessed: true,
        };

        return;
      }

      const wallet = await getActiveWallet(userId, BASE_CURRENCY, session);
      const currentBalance = fromDecimal128(wallet.availableBalance);

      if (currentBalance.lt(validatedAmount)) {
        throw new AppError("Insufficient available wallet balance.", 400);
      }

      const newBalance = currentBalance.minus(validatedAmount);

      wallet.availableBalance = toDecimal128(newBalance);
      wallet.lastTransactionAt = new Date();

      await wallet.save({ session });

      const ledgerEntry = await createLedgerEntry({
        wallet,
        userId,
        type: ledgerType,
        direction: "DEBIT",
        amount: validatedAmount,
        balanceAfter: newBalance,
        reference: normalizedReference,
        description,
        metadata,
        session,
      });

      result = {
        wallet,
        ledgerEntry,
        alreadyProcessed: false,
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

Moves USD from availableBalance to lockedBalance.

A reference should identify the specific reservation.
=====================================================
*/

const reserveWalletFunds = async ({
  userId,
  amount,
  currency = BASE_CURRENCY,
  type = "TRADE",
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);
  validateLedgerType(type);
  requireBaseCurrency(currency);

  if (!reference || !String(reference).trim()) {
    throw new AppError("A reservation reference is required.", 400);
  }

  const normalizedReference = String(reference).trim();
  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const existing = await LedgerEntry.findOne({
        reference: normalizedReference,
      }).session(session);

      if (existing) {
        throw new AppError(
          "This reference has already been used. Reservation retries require a dedicated reservation record.",
          409,
        );
      }

      const wallet = await getActiveWallet(userId, BASE_CURRENCY, session);
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

      await wallet.save({ session });

      result = {
        wallet,
        availableBalance: newAvailable.toFixed(WALLET_PRECISION),
        lockedBalance: newLocked.toFixed(WALLET_PRECISION),
        currency: BASE_CURRENCY,
        reference: normalizedReference,
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

Moves USD from lockedBalance back to availableBalance.

Call this only once for a confirmed cancellation or
release. A production withdrawal/trade workflow should
persist reservation state and make release idempotent.
=====================================================
*/

const releaseReservedFunds = async ({
  userId,
  amount,
  currency = BASE_CURRENCY,
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);
  requireBaseCurrency(currency);

  if (!reference || !String(reference).trim()) {
    throw new AppError("A release reference is required.", 400);
  }

  const normalizedReference = String(reference).trim();
  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const wallet = await getActiveWallet(userId, BASE_CURRENCY, session);
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

      await wallet.save({ session });

      result = {
        wallet,
        availableBalance: newAvailable.toFixed(WALLET_PRECISION),
        lockedBalance: newLocked.toFixed(WALLET_PRECISION),
        currency: BASE_CURRENCY,
        reference: normalizedReference,
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

Removes reserved USD after a trade or other operation
actually consumes it.

The unique ledger reference prevents duplicate ledger
entries, but a durable reservation record is still
needed to make the entire consume operation safely
idempotent across retries.
=====================================================
*/

const consumeReservedFunds = async ({
  userId,
  amount,
  currency = BASE_CURRENCY,
  type = "TRADE",
  reference = null,
  description = null,
  metadata = {},
}) => {
  const validatedAmount = validateAmount(amount);
  const ledgerType = validateLedgerType(type);
  requireBaseCurrency(currency);

  if (!reference || !String(reference).trim()) {
    throw new AppError("A consumption reference is required.", 400);
  }

  const normalizedReference = String(reference).trim();
  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const existingEntry = await LedgerEntry.findOne({
        reference: normalizedReference,
      }).session(session);

      if (existingEntry) {
        if (
          existingEntry.direction !== "DEBIT" ||
          String(existingEntry.user) !== String(userId) ||
          existingEntry.type !== ledgerType ||
          !fromDecimal128(existingEntry.amount).eq(validatedAmount)
        ) {
          throw new AppError(
            "This reference has already been used for a different transaction.",
            409,
          );
        }

        result = {
          wallet: await Wallet.findById(existingEntry.wallet).session(session),
          ledgerEntry: existingEntry,
          alreadyProcessed: true,
        };

        return;
      }

      const wallet = await getActiveWallet(userId, BASE_CURRENCY, session);
      const locked = fromDecimal128(wallet.lockedBalance);

      if (locked.lt(validatedAmount)) {
        throw new AppError("Reserved wallet balance is insufficient.", 400);
      }

      const newLocked = locked.minus(validatedAmount);
      const balanceAfter = fromDecimal128(wallet.availableBalance).plus(
        fromDecimal128(wallet.lockedBalance),
      );

      wallet.lockedBalance = toDecimal128(newLocked);
      wallet.lastTransactionAt = new Date();

      await wallet.save({ session });

      const ledgerEntry = await createLedgerEntry({
        wallet,
        userId,
        type: ledgerType,
        direction: "DEBIT",
        amount: validatedAmount,
        balanceAfter,
        reference: normalizedReference,
        description,
        metadata,
        session,
      });

      result = {
        wallet,
        ledgerEntry,
        alreadyProcessed: false,
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
  SUPPORTED_CURRENCIES,
  BASE_CURRENCY,
  normalizeCurrency,
  requireBaseCurrency,

  createWalletForUser,
  createDefaultWalletsForUser,
  getWalletForUser,
  getActiveWallet,

  creditWallet,
  debitWallet,

  reserveWalletFunds,
  releaseReservedFunds,
  consumeReservedFunds,

  createLedgerEntry,
  validateAmount,
  decimalToString,
  toDecimal128,
  fromDecimal128,
};
