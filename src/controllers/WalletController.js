const LedgerEntry = require("../models/LedgerEntryModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");

const {
  getWalletForUser,
} = require("./../services/walletServices");

/*
=====================================================
GET MY WALLET
GET /api/v1/wallet
=====================================================
*/
exports.getMyWallet = catchAsync(
  async (req, res, next) => {
    const wallet =
      await getWalletForUser(req.user._id);

    if (!wallet) {
      return next(
        new AppError(
          "Wallet not found.",
          404
        )
      );
    }

    res.status(200).json({
      status: "success",

      data: {
        wallet: {
          id: wallet._id,
          currency: wallet.currency,

          availableBalance:
            wallet.availableBalance.toString(),

          lockedBalance:
            wallet.lockedBalance.toString(),

          status: wallet.status,

          lastTransactionAt:
            wallet.lastTransactionAt,

          createdAt: wallet.createdAt,
        },
      },
    });
  }
);

/*
=====================================================
GET MY LEDGER
GET /api/v1/wallet/ledger
=====================================================
*/
exports.getMyLedger = catchAsync(
  async (req, res, next) => {
    const page = Math.max(
      Number(req.query.page) || 1,
      1
    );

    const limit = Math.min(
      Math.max(
        Number(req.query.limit) || 20,
        1
      ),
      100
    );

    const skip = (page - 1) * limit;

    const filter = {
      user: req.user._id,
    };

    if (req.query.type) {
      filter.type =
        req.query.type.toUpperCase();
    }

    const [transactions, total] =
      await Promise.all([
        LedgerEntry.find(filter)
          .sort({
            createdAt: -1,
          })
          .skip(skip)
          .limit(limit),

        LedgerEntry.countDocuments(
          filter
        ),
      ]);

    res.status(200).json({
      status: "success",

      results: transactions.length,

      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(
          total / limit
        ),
      },

      data: {
        transactions,
      },
    });
  }
);

