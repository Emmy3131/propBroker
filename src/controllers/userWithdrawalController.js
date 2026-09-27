const mongoose = require("mongoose");

const User = require("../models/UserModel");
const LedgerEntry = require("../models/LedgerEntryModel");
const Withdrawal = require("../models/WithdrawalModel");
const Wallet = require("../models/WalletModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");

const SUPPORTED_CURRENCIES = ["USD", "NGN", "CAD", "EUR"];

const MINIMUM_WITHDRAWAL = {
  USD: 10,
  NGN: 1000,
  CAD: 15,
  EUR: 10,
};

const MAXIMUM_WITHDRAWAL = {
  USD: 50000,
  NGN: 50000000,
  CAD: 50000,
  EUR: 50000,
};

/*
=====================================================
GENERATE WITHDRAWAL REFERENCE
=====================================================
*/

const generateWithdrawalReference = () => {
  const timestamp = Date.now();
  const random = Math.floor(100000 + Math.random() * 900000);

  return `WD-${timestamp}-${random}`;
};

/*
=====================================================
VALIDATE MONEY AMOUNT
=====================================================
*/

const validateAmount = (amount) => {
  if (amount === undefined || amount === null || amount === "") {
    throw new AppError("Withdrawal amount is required.", 400);
  }

  const value = String(amount).trim();

  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new AppError(
      "Invalid withdrawal amount. Use at most 2 decimal places.",
      400,
    );
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new AppError("Withdrawal amount must be greater than zero.", 400);
  }

  return {
    stringValue: value,
    numericValue,
  };
};

/*
=====================================================
CREATE WITHDRAWAL
=====================================================
*/

exports.createWithdrawal = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  const {
    amount,
    currency,
    payoutMethod = "bank_transfer",
    bankDetails,
  } = req.body;

  /*
    =================================================
    VALIDATE CURRENCY
    =================================================
    */

  const normalizedCurrency = String(currency || "").toUpperCase();

  if (!SUPPORTED_CURRENCIES.includes(normalizedCurrency)) {
    return next(new AppError("Unsupported withdrawal currency.", 400));
  }

  /*
    =================================================
    VALIDATE PAYOUT METHOD
    =================================================
    */

  if (payoutMethod !== "bank_transfer") {
    return next(
      new AppError(
        "Only bank transfer withdrawals are currently supported.",
        400,
      ),
    );
  }

  /*
    =================================================
    VALIDATE AMOUNT
    =================================================
    */

  let validatedAmount;

  try {
    validatedAmount = validateAmount(amount);
  } catch (error) {
    return next(error);
  }

  const { stringValue, numericValue } = validatedAmount;

  /*
    =================================================
    MINIMUM WITHDRAWAL
    =================================================
    */

  if (numericValue < MINIMUM_WITHDRAWAL[normalizedCurrency]) {
    return next(
      new AppError(
        `Minimum ${normalizedCurrency} withdrawal is ${MINIMUM_WITHDRAWAL[normalizedCurrency]}.`,
        400,
      ),
    );
  }

  /*
    =================================================
    MAXIMUM WITHDRAWAL
    =================================================
    */

  if (numericValue > MAXIMUM_WITHDRAWAL[normalizedCurrency]) {
    return next(
      new AppError(
        `Maximum ${normalizedCurrency} withdrawal is ${MAXIMUM_WITHDRAWAL[normalizedCurrency]}.`,
        400,
      ),
    );
  }

  /*
    =================================================
    VALIDATE BANK DETAILS
    =================================================
    */

  if (!bankDetails) {
    return next(new AppError("Bank details are required.", 400));
  }

  const { bankName, bankCode, accountName, accountNumber } = bankDetails;

  if (!bankName?.trim()) {
    return next(new AppError("Bank name is required.", 400));
  }

  if (!bankCode?.trim()) {
    return next(new AppError("Bank code is required.", 400));
  }

  if (!accountName?.trim()) {
    return next(new AppError("Account name is required.", 400));
  }

  if (!accountNumber?.trim()) {
    return next(new AppError("Account number is required.", 400));
  }

  /*
    =================================================
    FIND WALLET
    =================================================
    */

  const wallet = await Wallet.findOne({
    user: userId,
  });

  if (!wallet) {
    return next(new AppError("Wallet not found.", 404));
  }

  /*
    =================================================
    WALLET STATUS
    =================================================
    */

  if (wallet.status !== "active") {
    return next(
      new AppError(
        `Your wallet is currently ${wallet.status}. Withdrawals are not allowed.`,
        403,
      ),
    );
  }

  /*
    =================================================
    WALLET CURRENCY
    =================================================
    */

  if (wallet.currency !== normalizedCurrency) {
    return next(
      new AppError(
        `Your wallet currency is ${wallet.currency}. You cannot make a ${normalizedCurrency} withdrawal.`,
        400,
      ),
    );
  }

  /*
    =================================================
    CHECK BALANCE
    =================================================
    */

  const availableBalance = Number(wallet.availableBalance.toString());

  if (numericValue > availableBalance) {
    return next(new AppError("Insufficient available balance.", 400));
  }

  /*
    =================================================
    PREVENT MULTIPLE ACTIVE WITHDRAWALS
    =================================================
    */

  const existingWithdrawal = await Withdrawal.findOne({
    user: userId,
    status: {
      $in: ["pending", "under_review", "approved", "processing"],
    },
  });

  if (existingWithdrawal) {
    return next(
      new AppError(
        "You already have a withdrawal request being processed.",
        409,
      ),
    );
  }

  /*
    =================================================
    START TRANSACTION
    =================================================
    */

  const session = await mongoose.startSession();

  try {
    let withdrawal;

    await session.withTransaction(async () => {
      /*
          =============================================
          RELOAD WALLET INSIDE TRANSACTION
          =============================================
          */

      const currentWallet = await Wallet.findOne({
        user: userId,
      })
        .session(session)
        .exec();

      if (!currentWallet) {
        throw new AppError("Wallet not found.", 404);
      }

      if (currentWallet.status !== "active") {
        throw new AppError("Your wallet is not active.", 403);
      }

      if (currentWallet.currency !== normalizedCurrency) {
        throw new AppError(
          "Wallet currency does not match withdrawal currency.",
          400,
        );
      }

      /*
          =============================================
          CHECK BALANCE AGAIN
          =============================================
          */

      const currentAvailable = Number(
        currentWallet.availableBalance.toString(),
      );

      if (numericValue > currentAvailable) {
        throw new AppError("Insufficient available balance.", 400);
      }

      /*
          =============================================
          MOVE FUNDS
          =============================================
          */

      const currentLocked = Number(currentWallet.lockedBalance.toString());

      const newAvailable = currentAvailable - numericValue;

      const newLocked = currentLocked + numericValue;

      currentWallet.availableBalance = mongoose.Types.Decimal128.fromString(
        newAvailable.toFixed(8),
      );

      currentWallet.lockedBalance = mongoose.Types.Decimal128.fromString(
        newLocked.toFixed(8),
      );

      currentWallet.lastTransactionAt = new Date();

      await currentWallet.save({
        session,
      });

      /*
          =============================================
          CREATE WITHDRAWAL
          =============================================
          */

      const withdrawalReference = generateWithdrawalReference();

      const created = await Withdrawal.create(
        [
          {
            user: userId,
            wallet: currentWallet._id,

            reference: withdrawalReference,

            provider: "paystack",

            amount: mongoose.Types.Decimal128.fromString(stringValue),

            currency: normalizedCurrency,

            status: "pending",

            payoutMethod,

            bankDetails: {
              bankName: bankName.trim(),

              bankCode: bankCode.trim(),

              accountName: accountName.trim(),

              accountNumber: accountNumber.trim(),
            },
          },
        ],
        {
          session,
        },
      );

      withdrawal = created[0];
    });

    /*
      =================================================
      RESPONSE
      =================================================
      */

    return res.status(201).json({
      status: "success",
      message: "Withdrawal request submitted successfully.",
      data: {
        withdrawal: {
          _id: withdrawal._id,
          reference: withdrawal.reference,
          amount: withdrawal.amount.toString(),
          currency: withdrawal.currency,
          status: withdrawal.status,
          payoutMethod: withdrawal.payoutMethod,
          createdAt: withdrawal.createdAt,
        },
      },
    });
  } finally {
    await session.endSession();
  }
});

/*
=====================================================
GET MY WITHDRAWALS
=====================================================
*/

exports.getMyWithdrawals = catchAsync(async (req, res, next) => {
  const page = Math.max(Number(req.query.page) || 1, 1);

  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

  const skip = (page - 1) * limit;

  const filter = {
    user: req.user._id,
  };

  if (req.query.status) {
    const allowedStatuses = [
      "pending",
      "under_review",
      "approved",
      "processing",
      "successful",
      "rejected",
      "failed",
      "cancelled",
    ];

    const status = String(req.query.status).toLowerCase();

    if (!allowedStatuses.includes(status)) {
      return next(new AppError("Invalid withdrawal status.", 400));
    }

    filter.status = status;
  }

  const [withdrawals, total] = await Promise.all([
    Withdrawal.find(filter)
      .select("-providerData")
      .select("-bankDetails.accountNumber")
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    Withdrawal.countDocuments(filter),
  ]);

  res.status(200).json({
    status: "success",
    results: withdrawals.length,

    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },

    data: {
      withdrawals,
    },
  });
});

/*
=====================================================
GET SINGLE MY WITHDRAWAL
=====================================================
*/

exports.getMyWithdrawal = catchAsync(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return next(new AppError("Invalid withdrawal ID.", 400));
  }

  const withdrawal = await Withdrawal.findOne({
    _id: req.params.id,
    user: req.user._id,
  })
    .select("-providerData")
    .lean();

  if (!withdrawal) {
    return next(new AppError("Withdrawal not found.", 404));
  }

  /*
    ===============================================
    MASK ACCOUNT NUMBER
    ===============================================
    */

  if (withdrawal.bankDetails?.accountNumber) {
    const accountNumber = withdrawal.bankDetails.accountNumber;

    withdrawal.bankDetails.accountNumber = `******${accountNumber.slice(-4)}`;
  }

  res.status(200).json({
    status: "success",
    data: {
      withdrawal,
    },
  });
});

/*
=====================================================
ADMIN: GET ALL WITHDRAWALS
=====================================================
*/

exports.getAdminWithdrawals = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    search,
    status,
    provider,
    currency,
  } = req.query;

  const currentPage = Math.max(parseInt(page, 10) || 1, 1);

  const perPage = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  const skip = (currentPage - 1) * perPage;

  /*
    ===============================================
    BUILD FILTER
    ===============================================
    */

  const filter = {};

  /*
    STATUS
    */

  if (status) {
    const allowedStatuses = [
      "pending",
      "under_review",
      "approved",
      "processing",
      "successful",
      "rejected",
      "failed",
      "cancelled",
    ];

    const normalizedStatus = String(status).toLowerCase();

    if (!allowedStatuses.includes(normalizedStatus)) {
      return next(new AppError("Invalid withdrawal status.", 400));
    }

    filter.status = normalizedStatus;
  }

  /*
    PROVIDER
    */

  if (provider) {
    filter.provider = String(provider).toLowerCase();
  }

  /*
    CURRENCY
    */

  if (currency) {
    const normalizedCurrency = String(currency).toUpperCase();

    if (!SUPPORTED_CURRENCIES.includes(normalizedCurrency)) {
      return next(new AppError("Invalid withdrawal currency.", 400));
    }

    filter.currency = normalizedCurrency;
  }

  /*
    ===============================================
    SEARCH
    ===============================================
    
    We search the withdrawal reference first.
    User search is handled separately below.
    */

  if (search && search.trim()) {
    const searchValue = search.trim();

    const matchingUsers = await User.find({
      $or: [
        {
          name: {
            $regex: searchValue,
            $options: "i",
          },
        },
        {
          email: {
            $regex: searchValue,
            $options: "i",
          },
        },
        {
          phone: {
            $regex: searchValue,
            $options: "i",
          },
        },
      ],
    }).select("_id");

    const userIds = matchingUsers.map((user) => user._id);

    filter.$or = [
      {
        reference: {
          $regex: searchValue,
          $options: "i",
        },
      },
      {
        providerReference: {
          $regex: searchValue,
          $options: "i",
        },
      },
      {
        providerTransactionId: {
          $regex: searchValue,
          $options: "i",
        },
      },
      {
        "bankDetails.accountName": {
          $regex: searchValue,
          $options: "i",
        },
      },
      {
        "bankDetails.accountNumber": {
          $regex: searchValue,
          $options: "i",
        },
      },
      {
        user: {
          $in: userIds,
        },
      },
    ];
  }

  /*
    ===============================================
    GET WITHDRAWALS
    ===============================================
    */

  const [withdrawals, totalWithdrawals] = await Promise.all([
    Withdrawal.find(filter)
      .select("-providerData")
      .populate({
        path: "user",
        select: "name email phone country profileImage role status",
      })
      .populate({
        path: "wallet",
        select: "currency availableBalance lockedBalance status",
      })
      .populate({
        path: "reviewedBy",
        select: "name email role",
      })
      .populate({
        path: "processedBy",
        select: "name email role",
      })
      .populate({
        path: "ledgerEntry",
        select:
          "type direction amount currency balanceAfter reference createdAt",
      })
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(perPage)
      .lean(),

    Withdrawal.countDocuments(filter),
  ]);

  /*
    ===============================================
    MASK ACCOUNT NUMBERS
    ===============================================
    */

  withdrawals.forEach((withdrawal) => {
    if (withdrawal.bankDetails?.accountNumber) {
      const accountNumber = withdrawal.bankDetails.accountNumber;

      withdrawal.bankDetails.accountNumber = `******${accountNumber.slice(-4)}`;
    }
  });

  /*
    ===============================================
    SUMMARY
    ===============================================
    
    These counts intentionally ignore the table's
    status filter so the dashboard summary represents
    the overall withdrawal system.
    */

  const [
    totalCount,
    pendingCount,
    underReviewCount,
    approvedCount,
    processingCount,
    successfulCount,
    rejectedCount,
    failedCount,
    cancelledCount,
  ] = await Promise.all([
    Withdrawal.countDocuments(),

    Withdrawal.countDocuments({
      status: "pending",
    }),

    Withdrawal.countDocuments({
      status: "under_review",
    }),

    Withdrawal.countDocuments({
      status: "approved",
    }),

    Withdrawal.countDocuments({
      status: "processing",
    }),

    Withdrawal.countDocuments({
      status: "successful",
    }),

    Withdrawal.countDocuments({
      status: "rejected",
    }),

    Withdrawal.countDocuments({
      status: "failed",
    }),

    Withdrawal.countDocuments({
      status: "cancelled",
    }),
  ]);

  /*
    ===============================================
    VOLUME BY CURRENCY
    ===============================================
    */

  const volumeResults = await Withdrawal.aggregate([
    {
      $match: {
        status: "successful",
      },
    },
    {
      $group: {
        _id: "$currency",
        total: {
          $sum: "$amount",
        },
      },
    },
  ]);

  const volumeByCurrency = {
    USD: "0",
    NGN: "0",
    CAD: "0",
    EUR: "0",
  };

  volumeResults.forEach((item) => {
    if (Object.prototype.hasOwnProperty.call(volumeByCurrency, item._id)) {
      volumeByCurrency[item._id] = item.total.toString();
    }
  });

  /*
    ===============================================
    PAGINATION
    ===============================================
    */

  const totalPages = Math.ceil(totalWithdrawals / perPage);

  /*
    ===============================================
    RESPONSE
    ===============================================
    */

  res.status(200).json({
    status: "success",

    results: withdrawals.length,

    pagination: {
      totalWithdrawals,
      currentPage,
      perPage,
      totalPages,

      hasNextPage: currentPage < totalPages,

      hasPreviousPage: currentPage > 1,
    },

    data: {
      withdrawals,

      summary: {
        totalWithdrawals: totalCount,

        pendingWithdrawals: pendingCount,

        underReviewWithdrawals: underReviewCount,

        approvedWithdrawals: approvedCount,

        processingWithdrawals: processingCount,

        successfulWithdrawals: successfulCount,

        rejectedWithdrawals: rejectedCount,

        failedWithdrawals: failedCount,

        cancelledWithdrawals: cancelledCount,
      },

      volumeByCurrency,
    },
  });
});
