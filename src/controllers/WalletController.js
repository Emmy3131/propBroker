const mongoose = require("mongoose");
const LedgerEntry = require("../models/LedgerEntryModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");
const { randomUUID } = require("crypto");
const { getExchangeRate } = require("../services/exchangeRateService");
const Decimal = require("decimal.js");
const Wallet = require("../models/WalletModel");
const {
  getWalletForUser,
  createWalletForUser,
} = require("../services/walletServices");

/*
=====================================================
SUPPORTED CURRENCIES
=====================================================
*/

const SUPPORTED_CURRENCIES = ["USD", "NGN", "CAD", "EUR"];

/*
=====================================================
NORMALIZE CURRENCY
=====================================================
*/

const normalizeCurrency = (currency) => {
  const normalized = String(currency).trim().toUpperCase();

  if (!SUPPORTED_CURRENCIES.includes(normalized)) {
    throw new AppError(
      `Unsupported wallet currency: ${normalized}. Supported currencies are USD, NGN, CAD and EUR.`,
      400,
    );
  }

  return normalized;
};

/*
=====================================================
FORMAT WALLET
=====================================================
*/

const formatWallet = (wallet) => {
  return {
    id: wallet._id,
    currency: wallet.currency,

    availableBalance: wallet.availableBalance?.toString() || "0",

    lockedBalance: wallet.lockedBalance?.toString() || "0",

    status: wallet.status,

    lastTransactionAt: wallet.lastTransactionAt,

    createdAt: wallet.createdAt,

    updatedAt: wallet.updatedAt,
  };
};

/*
=====================================================
GET MY WALLETS
=====================================================

GET /api/v1/wallets

Returns all existing wallets.

GET /api/v1/wallets?currency=NGN

Returns the user's NGN wallet.

If the requested wallet does not exist,
it will be created automatically.
=====================================================
*/

exports.getMyWallet = catchAsync(async (req, res, next) => {
  const userId = req.user._id;
  const { currency } = req.query;

  /*
  ===================================================
  GET SPECIFIC CURRENCY WALLET
  ===================================================
  */

  if (currency) {
    let normalizedCurrency;

    try {
      normalizedCurrency = normalizeCurrency(currency);
    } catch (error) {
      return next(error);
    }

    /*
    ---------------------------------------------------
    Find the user's wallet
    ---------------------------------------------------
    */

    let wallet = await getWalletForUser(userId, normalizedCurrency);

    /*
    ---------------------------------------------------
    Create wallet if it doesn't exist
    ---------------------------------------------------
    */

    if (!wallet) {
      wallet = await createWalletForUser(userId, normalizedCurrency);
    }

    /*
    ---------------------------------------------------
    Safety check
    ---------------------------------------------------
    */

    if (!wallet) {
      return next(
        new AppError(
          `Unable to create or retrieve your ${normalizedCurrency} wallet.`,
          500,
        ),
      );
    }

    /*
    ---------------------------------------------------
    Return wallet
    ---------------------------------------------------
    */

    return res.status(200).json({
      status: "success",

      data: {
        wallet: formatWallet(wallet),
      },
    });
  }

  /*
  ===================================================
  GET ALL USER WALLETS
  ===================================================
  */

  let wallets = await getWalletForUser(userId);

  /*
  ---------------------------------------------------
  If no wallets exist, create default wallets
  ---------------------------------------------------

  We intentionally create all supported wallets here
  so the user can immediately see USD, NGN, CAD and EUR.
  ---------------------------------------------------
  */

  if (!Array.isArray(wallets)) {
    wallets = [];
  }

  /*
  ---------------------------------------------------
  If user has no wallets at all, create the default
  currency wallets.
  ---------------------------------------------------
  */

  if (wallets.length === 0) {
    const currencies = SUPPORTED_CURRENCIES;

    wallets = [];

    for (const walletCurrency of currencies) {
      const wallet = await createWalletForUser(userId, walletCurrency);

      if (wallet) {
        wallets.push(wallet);
      }
    }
  }

  /*
  ---------------------------------------------------
  RESPONSE
  ---------------------------------------------------
  */

  return res.status(200).json({
    status: "success",

    results: wallets.length,

    data: {
      wallets: wallets.map(formatWallet),
    },
  });
});

/*
=====================================================
GET MY LEDGER
=====================================================

GET /api/v1/wallets/ledger

Optional query parameters:

?page=1
?limit=20
?type=DEPOSIT
?currency=NGN
=====================================================
*/

exports.getMyLedger = catchAsync(async (req, res, next) => {
  /*
  ===================================================
  PAGINATION
  ===================================================
  */

  const page = Math.max(Number(req.query.page) || 1, 1);

  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

  const skip = (page - 1) * limit;

  /*
  ===================================================
  BASE FILTER
  ===================================================
  */

  const filter = {
    user: req.user._id,
  };

  /*
  ===================================================
  LEDGER TYPE FILTER
  ===================================================
  */

  if (req.query.type) {
    filter.type = String(req.query.type).toUpperCase();
  }

  /*
  ===================================================
  CURRENCY FILTER
  ===================================================
  */

  if (req.query.currency) {
    let normalizedCurrency;

    try {
      normalizedCurrency = normalizeCurrency(req.query.currency);
    } catch (error) {
      return next(error);
    }

    filter.currency = normalizedCurrency;
  }

  /*
  ===================================================
  GET TRANSACTIONS + TOTAL
  ===================================================
  */

  const [transactions, total] = await Promise.all([
    LedgerEntry.find(filter)
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit),

    LedgerEntry.countDocuments(filter),
  ]);

  /*
  ===================================================
  PAGINATION
  ===================================================
  */

  const totalPages = Math.ceil(total / limit);

  /*
  ===================================================
  RESPONSE
  ===================================================
  */

  return res.status(200).json({
    status: "success",

    results: transactions.length,

    pagination: {
      total,
      page,
      limit,
      pages: totalPages,

      hasNextPage: page < totalPages,

      hasPreviousPage: page > 1,
    },

    data: {
      transactions,
    },
  });
});

/*
=====================================================
CONVERT WALLET CURRENCY
=====================================================

POST /api/v1/wallets/convert

Body:
{
    "fromCurrency": "USD",
    "toCurrency": "NGN"
}

Converts the source wallet's entire AVAILABLE balance.
Locked funds are not converted.
=====================================================
*/

exports.convertWalletCurrency = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  let fromCurrency;
  let toCurrency;

  try {
    fromCurrency = normalizeCurrency(req.body.fromCurrency);
    toCurrency = normalizeCurrency(req.body.toCurrency);
  } catch (error) {
    return next(error);
  }

  if (fromCurrency === toCurrency) {
    return next(new AppError("Select a different target currency.", 400));
  }

  let exchange;

  try {
    exchange = await getExchangeRate(fromCurrency, toCurrency);
  } catch (error) {
    return next(
      new AppError(
        error.message || "Exchange rates are temporarily unavailable.",
        503,
      ),
    );
  }

  const rate = new Decimal(exchange.rate);
  const conversionReference = `FX-${randomUUID()}`;

  const session = await mongoose.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      const sourceWallet = await Wallet.findOne({
        user: userId,
        currency: fromCurrency,
      }).session(session);

      if (!sourceWallet) {
        throw new AppError(`Your ${fromCurrency} wallet was not found.`, 404);
      }

      if (sourceWallet.status !== "active") {
        throw new AppError("Your source wallet is not active.", 403);
      }

      const sourceBalance = new Decimal(
        sourceWallet.availableBalance?.toString() || "0",
      );

      if (!sourceBalance.isFinite() || sourceBalance.lte(0)) {
        throw new AppError(
          `Your ${fromCurrency} wallet has no available balance to convert.`,
          400,
        );
      }

      let targetWallet = await Wallet.findOne({
        user: userId,
        currency: toCurrency,
      }).session(session);

      if (targetWallet && targetWallet.status !== "active") {
        throw new AppError("Your target wallet is not active.", 403);
      }

      if (!targetWallet) {
        targetWallet = new Wallet({
          user: userId,
          currency: toCurrency,
          availableBalance: "0",
          lockedBalance: "0",
          status: "active",
        });
      }

      // All source available funds are converted.
      // Target currency amounts are rounded down to 2 decimals.
      const convertedAmount = sourceBalance
        .mul(rate)
        .toDecimalPlaces(2, Decimal.ROUND_DOWN);

      if (convertedAmount.lte(0)) {
        throw new AppError("The converted amount is too small to credit.", 400);
      }

      const targetBalanceBefore = new Decimal(
        targetWallet.availableBalance?.toString() || "0",
      );

      const targetBalanceAfter = targetBalanceBefore.plus(convertedAmount);

      // Debit source and credit target in one transaction.
      sourceWallet.availableBalance = "0";
      sourceWallet.lastTransactionAt = new Date();

      targetWallet.availableBalance = targetBalanceAfter.toFixed(2);
      targetWallet.lastTransactionAt = new Date();

      await sourceWallet.save({ session });
      await targetWallet.save({ session });

      // Ledger entries are immutable: create a debit and a credit.
      await LedgerEntry.create(
        [
          {
            wallet: sourceWallet._id,
            user: userId,
            type: "TRANSFER",
            direction: "DEBIT",
            amount: sourceBalance.toFixed(),
            currency: fromCurrency,
            balanceAfter: "0",
            reference: `${conversionReference}-DEBIT`,
            description: `Currency conversion from ${fromCurrency} to ${toCurrency}`,
            metadata: {
              conversionReference,
              fromCurrency,
              toCurrency,
              exchangeRate: rate.toString(),
              convertedAmount: convertedAmount.toFixed(2),
              side: "debit",
              rateProvider: exchange.provider,
              rateUpdatedAt: exchange.rateUpdatedAt,
            },
          },
          {
            wallet: targetWallet._id,
            user: userId,
            type: "TRANSFER",
            direction: "CREDIT",
            amount: convertedAmount.toFixed(2),
            currency: toCurrency,
            balanceAfter: targetBalanceAfter.toFixed(2),
            reference: `${conversionReference}-CREDIT`,
            description: `Currency conversion from ${fromCurrency} to ${toCurrency}`,
            metadata: {
              conversionReference,
              fromCurrency,
              toCurrency,
              exchangeRate: rate.toString(),
              sourceAmount: sourceBalance.toFixed(),
              side: "credit",
              rateProvider: exchange.provider,
              rateUpdatedAt: exchange.rateUpdatedAt,
            },
          },
        ],
        { session },
      );

      result = {
        reference: conversionReference,
        fromCurrency,
        toCurrency,
        sourceAmount: sourceBalance.toFixed(),
        convertedAmount: convertedAmount.toFixed(2),
        exchangeRate: rate.toString(),
        rateUpdatedAt: exchange.rateUpdatedAt,
        sourceWallet: {
          id: sourceWallet._id,
          currency: fromCurrency,
          availableBalance: "0",
          lockedBalance: sourceWallet.lockedBalance?.toString() || "0",
        },
        targetWallet: {
          id: targetWallet._id,
          currency: toCurrency,
          availableBalance: targetBalanceAfter.toFixed(2),
          lockedBalance: targetWallet.lockedBalance?.toString() || "0",
        },
      };
    });
  } finally {
    await session.endSession();
  }

  return res.status(200).json({
    status: "success",
    message: "Wallet currency converted successfully.",
    data: {
      conversion: result,
    },
  });
});
