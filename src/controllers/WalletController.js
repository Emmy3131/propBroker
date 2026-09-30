const LedgerEntry = require("../models/LedgerEntryModel");

const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");

const { getWalletForUser } = require("../services/walletServices");

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
GET /api/v1/wallet
=====================================================

Without currency:

GET /api/v1/wallet

Returns all wallets.

With currency:

GET /api/v1/wallet?currency=NGN

Returns only the NGN wallet.
=====================================================
*/

exports.getMyWallet = catchAsync(async (req, res, next) => {
  const { currency } = req.query;

  /*
    =================================================
    GET SPECIFIC CURRENCY WALLET
    =================================================
    */

  if (currency) {
    let normalizedCurrency;

    try {
      normalizedCurrency = normalizeCurrency(currency);
    } catch (error) {
      return next(error);
    }

    const wallet = await getWalletForUser(req.user._id, normalizedCurrency);

    if (!wallet) {
      return next(new AppError(`No ${normalizedCurrency} wallet found.`, 404));
    }

    return res.status(200).json({
      status: "success",

      data: {
        wallet: formatWallet(wallet),
      },
    });
  }

  /*
    =================================================
    GET ALL USER WALLETS
    =================================================
    */

  const wallets = await getWalletForUser(req.user._id);

  /*
    -------------------------------------------------
    SAFETY
    -------------------------------------------------
    */

  if (!Array.isArray(wallets)) {
    return next(new AppError("Unable to retrieve user wallets.", 500));
  }

  /*
    -------------------------------------------------
    RESPONSE
    -------------------------------------------------
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
GET /api/v1/wallet/ledger
=====================================================

Optional query parameters:

?page=1
?limit=20
?type=DEPOSIT
?currency=NGN

Examples:

/wallet/ledger

/wallet/ledger?page=2&limit=20

/wallet/ledger?type=DEPOSIT

/wallet/ledger?currency=NGN

/wallet/ledger?type=DEPOSIT&currency=NGN
=====================================================
*/

exports.getMyLedger = catchAsync(async (req, res, next) => {
  /*
    =================================================
    PAGINATION
    =================================================
    */

  const page = Math.max(Number(req.query.page) || 1, 1);

  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

  const skip = (page - 1) * limit;

  /*
    =================================================
    BASE FILTER
    =================================================
    */

  const filter = {
    user: req.user._id,
  };

  /*
    =================================================
    LEDGER TYPE FILTER
    =================================================
    */

  if (req.query.type) {
    filter.type = String(req.query.type).toUpperCase();
  }

  /*
    =================================================
    CURRENCY FILTER
    =================================================
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
    =================================================
    GET TRANSACTIONS + TOTAL
    =================================================
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
    =================================================
    PAGINATION
    =================================================
    */

  const totalPages = Math.ceil(total / limit);

  /*
    =================================================
    RESPONSE
    =================================================
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
