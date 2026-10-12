const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const Wallet = require("../models/WalletModel");
const WalletReservation = require("../models/ReservationModel");
const LedgerEntry = require("../models/LedgerEntryModel");

const BASE_CURRENCY = "USD";
const PRECISION = 8;

const toDecimal = (value) => {
  try {
    const result = new Decimal(
      value && typeof value.toString === "function" ? value.toString() : value,
    );

    if (!result.isFinite()) {
      throw new Error("Invalid monetary value.");
    }

    return result;
  } catch {
    throw new Error("Invalid monetary value.");
  }
};

const toDecimal128 = (value) => {
  const amount = toDecimal(value).toDecimalPlaces(
    PRECISION,
    Decimal.ROUND_HALF_UP,
  );

  return mongoose.Types.Decimal128.fromString(amount.toFixed(PRECISION));
};

const fail = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
};

const requireSession = (session) => {
  if (!session || !session.inTransaction()) {
    fail(
      "A MongoDB transaction is required for wallet reservation operations.",
      500,
    );
  }
};

const loadWallet = async ({ walletId, userId, session }) => {
  const wallet = await Wallet.findOne({
    _id: walletId,
    user: userId,
  }).session(session);

  if (!wallet) {
    fail("Wallet not found.", 404);
  }

  if (wallet.status !== "active") {
    fail("This wallet is not active.", 403);
  }

  if ((wallet.baseCurrency || wallet.currency) !== BASE_CURRENCY) {
    fail("Wallet accounting must use USD.", 400);
  }

  return wallet;
};

const loadReservation = async (reference, session) => {
  const reservation = await WalletReservation.findOne({
    reference: String(reference).trim(),
  }).session(session);

  if (!reservation) {
    fail("Wallet reservation not found.", 404);
  }

  return reservation;
};

/**
 * Reserve USD from availableBalance into lockedBalance.
 *
 * Call this inside the same transaction that creates the withdrawal.
 * Repeating the same reference does not reserve the funds twice.
 */
const reserveFunds = async ({
  session,
  userId,
  walletId,
  reference,
  amountUsd,
  metadata = null,
}) => {
  requireSession(session);

  if (!mongoose.isValidObjectId(userId)) {
    fail("Invalid user ID.");
  }

  if (!mongoose.isValidObjectId(walletId)) {
    fail("Invalid wallet ID.");
  }

  const normalizedReference = String(reference || "").trim();

  if (!normalizedReference) {
    fail("Reservation reference is required.");
  }

  const amount = toDecimal(amountUsd).toDecimalPlaces(
    PRECISION,
    Decimal.ROUND_HALF_UP,
  );

  if (amount.lte(0)) {
    fail("Reservation amount must be greater than zero.");
  }

  // Check for an existing reservation before changing balances.
  const existing = await WalletReservation.findOne({
    reference: normalizedReference,
  }).session(session);

  if (existing) {
    const sameAmount = toDecimal(existing.amount).eq(amount);

    if (
      existing.user.toString() !== String(userId) ||
      existing.wallet.toString() !== String(walletId) ||
      !sameAmount
    ) {
      fail("Reservation reference already exists with different details.", 409);
    }

    if (existing.status === "held") {
      return existing;
    }

    fail(`This reservation has already been ${existing.status}.`, 409);
  }

  const wallet = await loadWallet({
    walletId,
    userId,
    session,
  });

  const available = toDecimal(wallet.availableBalance || "0");
  const locked = toDecimal(wallet.lockedBalance || "0");

  if (available.lt(amount)) {
    fail("Insufficient available USD balance.", 400);
  }

  wallet.availableBalance = toDecimal128(available.minus(amount));
  wallet.lockedBalance = toDecimal128(locked.plus(amount));
  wallet.lastTransactionAt = new Date();

  await wallet.save({ session });

  const reservation = new WalletReservation({
    user: userId,
    wallet: wallet._id,
    reference: normalizedReference,
    amount: toDecimal128(amount),
    currency: BASE_CURRENCY,
    status: "held",
    metadata,
  });

  await reservation.save({ session });

  return reservation;
};

/**
 * Release a held reservation back into availableBalance.
 * A previously released reservation cannot release funds again.
 */
const releaseFunds = async ({
  session,
  reference,
  reason = "Withdrawal funds released",
}) => {
  requireSession(session);

  const reservation = await loadReservation(reference, session);

  if (reservation.status === "released") {
    return reservation;
  }

  if (reservation.status === "consumed") {
    fail("Consumed funds cannot be released.", 409);
  }

  const wallet = await loadWallet({
    walletId: reservation.wallet,
    userId: reservation.user,
    session,
  });

  const amount = toDecimal(reservation.amount);
  const locked = toDecimal(wallet.lockedBalance || "0");
  const available = toDecimal(wallet.availableBalance || "0");

  if (locked.lt(amount)) {
    fail("Locked balance is insufficient to release this reservation.", 409);
  }

  wallet.lockedBalance = toDecimal128(locked.minus(amount));
  wallet.availableBalance = toDecimal128(available.plus(amount));
  wallet.lastTransactionAt = new Date();

  await wallet.save({ session });

  reservation.status = "released";
  reservation.releasedAt = new Date();
  reservation.metadata = {
    ...(reservation.metadata && typeof reservation.metadata === "object"
      ? reservation.metadata
      : {}),
    releaseReason: reason,
  };

  await reservation.save({ session });

  return reservation;
};

/**
 * Consume a held reservation after payout success is confirmed.
 * Creates a USD ledger debit and removes the funds from lockedBalance.
 */
const consumeFunds = async ({
  session,
  reference,
  description = "Withdrawal completed",
  metadata = null,
}) => {
  requireSession(session);

  const reservation = await loadReservation(reference, session);

  if (reservation.status === "consumed") {
    const existingEntry = await LedgerEntry.findOne({
      reference: reservation.reference,
      wallet: reservation.wallet,
      type: "WITHDRAWAL",
      direction: "DEBIT",
    }).session(session);

    if (!existingEntry) {
      fail(
        "Reservation is consumed but its withdrawal ledger entry is missing.",
        409,
      );
    }

    return {
      reservation,
      ledgerEntry: existingEntry,
    };
  }

  if (reservation.status === "released") {
    fail("Released funds cannot be consumed.", 409);
  }

  const wallet = await loadWallet({
    walletId: reservation.wallet,
    userId: reservation.user,
    session,
  });

  const amount = toDecimal(reservation.amount);
  const locked = toDecimal(wallet.lockedBalance || "0");
  const available = toDecimal(wallet.availableBalance || "0");

  if (locked.lt(amount)) {
    fail("Locked balance is insufficient to complete this withdrawal.", 409);
  }

  // The reservation reference is also the unique ledger reference.
  const existingEntry = await LedgerEntry.findOne({
    reference: reservation.reference,
  }).session(session);

  if (existingEntry) {
    fail("A ledger entry already exists for this reservation.", 409);
  }

  wallet.lockedBalance = toDecimal128(locked.minus(amount));
  wallet.lastTransactionAt = new Date();

  await wallet.save({ session });

  const ledgerEntry = new LedgerEntry({
    wallet: wallet._id,
    user: reservation.user,
    type: "WITHDRAWAL",
    direction: "DEBIT",
    amount: toDecimal128(amount),
    currency: BASE_CURRENCY,
    balanceAfter: toDecimal128(available),
    reference: reservation.reference,
    description,
    metadata: {
      ...(metadata && typeof metadata === "object" ? metadata : {}),
      reservationReference: reservation.reference,
      payoutCurrency: reservation.metadata?.payoutCurrency || null,
    },
  });

  await ledgerEntry.save({ session });

  reservation.status = "consumed";
  reservation.consumedAt = new Date();
  await reservation.save({ session });

  return {
    reservation,
    ledgerEntry,
  };
};

module.exports = {
  reserveFunds,
  releaseFunds,
  consumeFunds,
};
