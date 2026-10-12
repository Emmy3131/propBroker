const LedgerEntry = require("../models/LedgerEntryModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");
const Wallet = require("../models/WalletModel");
const Decimal = require("decimal.js");

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
      400
    );
  }

  return normalized;
};

/*
=====================================================
FORMAT WALLET
=====================================================

The wallet stores its actual accounting balance
in USD. Display currency is only a preference.

Total balance = available balance + locked balance.
=====================================================
*/

const formatWallet = (wallet) => {
  if (!wallet) return null;

  const availableBalance =
    wallet.availableBalance?.toString() || "0";

  const lockedBalance =
    wallet.lockedBalance?.toString() || "0";

  // Calculate the total for THIS wallet.
  // Decimal.js avoids ordinary floating-point errors.
  const totalBalance = new Decimal(availableBalance)
    .plus(new Decimal(lockedBalance))
    .toString();

  const baseCurrency =
    wallet.baseCurrency || wallet.currency || "USD";

  return {
    id: wallet._id,

    baseCurrency,

    // Backward compatibility with existing frontend code.
    currency: baseCurrency,

    displayCurrency: wallet.displayCurrency || "USD",

    availableBalance,
    lockedBalance,
    totalBalance,

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
GET /api/v1/wallets?currency=USD

Returns the user's existing wallet or creates
one USD wallet if none exists.
=====================================================
*/

exports.getMyWallet = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  if (req.query.currency) {
    normalizeCurrency(req.query.currency);
  }

  let wallet = await getWalletForUser(userId);

  if (!wallet) {
    // Always create the accounting wallet in USD.
    wallet = await createWalletForUser(userId, "USD");
  }

  if (!wallet) {
    return next(
      new AppError(
        "Unable to retrieve or create your wallet.",
        500
      )
    );
  }

  const formattedWallet = formatWallet(wallet);

  return res.status(200).json({
    status: "success",
    data: {
      wallet: formattedWallet,

      // Compatibility with older frontend components.
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

This only saves the display preference.
It does not convert or transfer money.
=====================================================
*/

exports.updateMyDisplayCurrency = catchAsync(
  async (req, res, next) => {
    const userId = req.user._id;

    const displayCurrency = normalizeCurrency(
      req.body.displayCurrency
    );

    let wallet = await getWalletForUser(userId);

    if (!wallet) {
      // Display preference must never determine
      // the accounting wallet's currency.
      wallet = await createWalletForUser(userId, "USD");
    }

    if (!wallet) {
      return next(
        new AppError(
          "Unable to retrieve or create your wallet.",
          500
        )
      );
    }

    if (wallet.status === "closed") {
      return next(
        new AppError(
          "Your wallet is closed. Its settings cannot be changed.",
          403
        )
      );
    }

    wallet.displayCurrency = displayCurrency;

    await wallet.save();

    return res.status(200).json({
      status: "success",
      message: "Display currency updated successfully.",
      data: {
        wallet: formatWallet(wallet),
      },
    });
  }
);

/*
=====================================================
LEGACY CURRENCY CONVERSION ENDPOINT
=====================================================

This endpoint no longer converts balances.

It only updates displayCurrency so existing routes
can continue working while the frontend is updated.
=====================================================
*/

exports.convertWalletCurrency = catchAsync(
  async (req, res, next) => {
    const requestedCurrency =
      req.body.displayCurrency || req.body.toCurrency;

    const displayCurrency = normalizeCurrency(
      requestedCurrency
    );

    const userId = req.user._id;

    let wallet = await getWalletForUser(userId);

    if (!wallet) {
      wallet = await createWalletForUser(userId, "USD");
    }

    if (!wallet) {
      return next(
        new AppError(
          "Unable to retrieve or create your wallet.",
          500
        )
      );
    }

    if (wallet.status === "closed") {
      return next(
        new AppError(
          "Your wallet is closed. Its settings cannot be changed.",
          403
        )
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
  }
);

/*
=====================================================
GET MY LEDGER
=====================================================

GET /api/v1/wallets/ledger

Optional:
?page=1
&limit=20
&type=DEPOSIT
&currency=USD
=====================================================
*/

exports.getMyLedger = catchAsync(
  async (req, res, next) => {
    const page = Math.max(
      Number(req.query.page) || 1,
      1
    );

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 20, 1),
      100
    );

    const skip = (page - 1) * limit;

    const filter = {
      user: req.user._id,
    };

    /*
    ===============================================
    TYPE FILTER
    ===============================================
    */

    if (req.query.type) {
      const type = String(req.query.type)
        .trim()
        .toUpperCase();

      if (!/^[A-Z_]+$/.test(type)) {
        return next(
          new AppError(
            "Invalid ledger transaction type.",
            400
          )
        );
      }

      filter.type = type;
    }

    /*
    ===============================================
    CURRENCY FILTER
    ===============================================
    */

    if (req.query.currency) {
      const currency = normalizeCurrency(
        req.query.currency
      );

      filter.currency = currency;
    }

    /*
    ===============================================
    GET TRANSACTIONS AND COUNT
    ===============================================
    */

    const [transactions, total] = await Promise.all([
      LedgerEntry.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      LedgerEntry.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);

    /*
    ===============================================
    RESPONSE
    ===============================================
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
  }
);