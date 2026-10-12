const LedgerEntry = require("../models/LedgerEntryModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");
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
  if (typeof currency !== "string" || !currency.trim()) {
    throw new AppError("Please provide a currency.", 400);
  }

  const normalized = currency.trim().toUpperCase();

  if (!SUPPORTED_CURRENCIES.includes(normalized)) {
    throw new AppError(
      "Unsupported currency. Choose USD, NGN, CAD or EUR.",
      400,
    );
  }

  return normalized;
};

/*
=====================================================
FORMAT WALLET
=====================================================

Every user has one wallet.

baseCurrency:
The currency in which real wallet balances are stored.

displayCurrency:
The currency the user prefers to see in the interface.

Changing displayCurrency never changes the balance.
=====================================================
*/

const formatWallet = (wallet) => {
  if (!wallet) return null;

  const availableBalance = wallet.availableBalance?.toString() || "0";
  const lockedBalance = wallet.lockedBalance?.toString() || "0";

  return {
    id: wallet._id,

    // Actual accounting currency.
    baseCurrency: wallet.baseCurrency || "USD",

    // Keep for compatibility with existing frontend code.
    currency: wallet.baseCurrency || "USD",

    // User's display preference.
    displayCurrency: wallet.displayCurrency || "USD",

    availableBalance,
    lockedBalance,

    totalBalance: (
      Number(availableBalance) + Number(lockedBalance)
    ).toString(),

    status: wallet.status,
    lastTransactionAt: wallet.lastTransactionAt,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
};

/*
=====================================================
GET MY WALLET
=====================================================

GET /api/v1/wallets

GET /api/v1/wallets?currency=NGN

Returns the user's single USD-based wallet.

The optional currency query is validated for
compatibility, but it does not create another wallet
or change the saved display preference.
=====================================================
*/

exports.getMyWallet = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  // Support existing frontend requests that include
  // ?currency=USD, ?currency=NGN, etc.
  if (req.query.currency) {
    try {
      normalizeCurrency(req.query.currency);
    } catch (error) {
      return next(error);
    }
  }

  let wallet = await getWalletForUser(userId);

  // Create only one wallet if the user does not have one.
  if (!wallet) {
    wallet = await createWalletForUser(userId, "USD");
  }

  if (!wallet) {
    return next(
      new AppError("Unable to retrieve or create your wallet.", 500),
    );
  }

  const formattedWallet = formatWallet(wallet);

  return res.status(200).json({
    status: "success",
    data: {
      wallet: formattedWallet,

      // Temporary compatibility for components that
      // previously expected data.wallets.
      wallets: [formattedWallet],
    },
  });
});

/*
=====================================================
UPDATE MY DISPLAY CURRENCY
=====================================================

PATCH /api/v1/wallets/display-currency

Body:
{
  "displayCurrency": "NGN"
}

This changes the user's display preference only.

It does NOT:
- Move funds.
- Change availableBalance or lockedBalance.
- Create another wallet.
- Create a transfer ledger entry.
=====================================================
*/

exports.updateMyDisplayCurrency = catchAsync(
  async (req, res, next) => {
    const userId = req.user._id;

    let displayCurrency;

    try {
      displayCurrency = normalizeCurrency(req.body.displayCurrency);
    } catch (error) {
      return next(error);
    }

    let wallet = await getWalletForUser(userId);

    if (!wallet) {
      wallet = await createWalletForUser(userId, displayCurrency);
    }

    if (!wallet) {
      return next(
        new AppError("Unable to retrieve or create your wallet.", 500),
      );
    }

    if (wallet.status === "closed") {
      return next(
        new AppError(
          "Your wallet is closed. Its settings cannot be changed.",
          403,
        ),
      );
    }

    // Save the preference only. Do not modify balances.
    wallet.displayCurrency = displayCurrency;

    await wallet.save();

    return res.status(200).json({
      status: "success",
      message: "Display currency updated successfully.",
      data: {
        wallet: formatWallet(wallet),
      },
    });
  },
);

/*
=====================================================
LEGACY CURRENCY CONVERSION ENDPOINT
=====================================================

Keep this export temporarily so an existing route
that references convertWalletCurrency does not crash.

This no longer performs a financial conversion.

Legacy request:
{
  "fromCurrency": "USD",
  "toCurrency": "NGN"
}

Only toCurrency is used as the display preference.
New frontend code should use:
PATCH /api/v1/wallets/display-currency
=====================================================
*/

exports.convertWalletCurrency = catchAsync(
  async (req, res, next) => {
    const requestedCurrency =
      req.body.displayCurrency || req.body.toCurrency;

    let displayCurrency;

    try {
      displayCurrency = normalizeCurrency(requestedCurrency);
    } catch (error) {
      return next(error);
    }

    const userId = req.user._id;

    let wallet = await getWalletForUser(userId);

    if (!wallet) {
      wallet = await createWalletForUser(userId, displayCurrency);
    }

    if (!wallet) {
      return next(
        new AppError("Unable to retrieve or create your wallet.", 500),
      );
    }

    if (wallet.status === "closed") {
      return next(
        new AppError(
          "Your wallet is closed. Its settings cannot be changed.",
          403,
        ),
      );
    }

    wallet.displayCurrency = displayCurrency;

    await wallet.save();

    return res.status(200).json({
      status: "success",
      message:
        "Display currency updated. Your wallet balance was not converted.",
      data: {
        wallet: formatWallet(wallet),
      },
    });
  },
);

/*
=====================================================
GET MY LEDGER
=====================================================

GET /api/v1/wallets/ledger

Optional query parameters:
?page=1
?limit=20
?type=DEPOSIT
?currency=USD

Ledger currency represents the currency recorded on
each transaction. Under the single-USD-wallet model,
new wallet balance entries should use USD.
=====================================================
*/

exports.getMyLedger = catchAsync(async (req, res, next) => {
  /*
  ===================================================
  PAGINATION
  ===================================================
  */

  const page = Math.max(Number(req.query.page) || 1, 1);

  const limit = Math.min(
    Math.max(Number(req.query.limit) || 20, 1),
    100,
  );

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
  TYPE FILTER
  ===================================================
  */

  if (req.query.type) {
    const type = String(req.query.type).trim().toUpperCase();

    if (!/^[A-Z_]+$/.test(type)) {
      return next(new AppError("Invalid ledger transaction type.", 400));
    }

    filter.type = type;
  }

  /*
  ===================================================
  CURRENCY FILTER
  ===================================================
  */

  if (req.query.currency) {
    let currency;

    try {
      currency = normalizeCurrency(req.query.currency);
    } catch (error) {
      return next(error);
    }

    filter.currency = currency;
  }

  /*
  ===================================================
  GET TRANSACTIONS AND COUNT
  ===================================================
  */

  const [transactions, total] = await Promise.all([
    LedgerEntry.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

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