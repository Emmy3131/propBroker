const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const User = require("../models/UserModel");
const LedgerEntry = require("../models/LedgerEntryModel");
const Withdrawal = require("../models/WithdrawalModel");
const Wallet = require("../models/WalletModel");
const WalletReservation = require("../models/ReservationModel");

const walletReservationService = require("../services/reservationService");
const { getExchangeRate } = require("../services/exchangeRateServices");

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

const ACTIVE_WITHDRAWAL_STATUSES = [
  "pending",
  "under_review",
  "approved",
  "processing",
];

const WITHDRAWAL_STATUSES = [
  ...ACTIVE_WITHDRAWAL_STATUSES,
  "successful",
  "rejected",
  "failed",
  "cancelled",
];

const generateWithdrawalReference = () => {
  const timestamp = Date.now();
  const random = Math.floor(100000 + Math.random() * 900000);

  return `WD-${timestamp}-${random}`;
};

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

  const decimal = new Decimal(value);

  if (!decimal.isFinite() || decimal.lte(0)) {
    throw new AppError("Withdrawal amount must be greater than zero.", 400);
  }

  return {
    stringValue: value,
    decimal,
    numericValue: decimal.toNumber(),
  };
};

const toDecimal = (value) =>
  new Decimal(value?.toString?.() ?? String(value ?? "0"));

const toDecimal128 = (value) =>
  mongoose.Types.Decimal128.fromString(
    toDecimal(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8),
  );

const maskAccountNumber = (accountNumber) =>
  accountNumber ? `******${String(accountNumber).slice(-4)}` : null;

const convertPayoutToUsd = async (amount, currency) => {
  const payoutAmount = toDecimal(amount);

  if (!payoutAmount.isFinite() || payoutAmount.lte(0)) {
    throw new AppError("Invalid withdrawal amount.", 400);
  }

  // USD payouts use a fixed USD-to-USD rate.
  if (currency === "USD") {
    return {
      walletAmountUsd: payoutAmount.toDecimalPlaces(8, Decimal.ROUND_HALF_UP),
      exchangeRate: new Decimal(1),
      exchangeRateUpdatedAt: new Date(),
      exchangeRateProvider: "USD_BASE",
    };
  }

  const exchange = await getExchangeRate(currency, "USD");
  const rate = toDecimal(exchange?.rate);

  if (!rate.isFinite() || rate.lte(0)) {
    throw new AppError(
      `Unable to obtain a valid ${currency} to USD exchange rate.`,
      503,
    );
  }

  const walletAmountUsd = payoutAmount
    .mul(rate)
    .toDecimalPlaces(8, Decimal.ROUND_UP);

  if (!walletAmountUsd.isFinite() || walletAmountUsd.lte(0)) {
    throw new AppError("Invalid USD withdrawal amount.", 400);
  }

  return {
    walletAmountUsd,
    exchangeRate: rate,
    exchangeRateUpdatedAt: exchange?.updatedAt
      ? new Date(exchange.updatedAt)
      : new Date(),
    exchangeRateProvider: exchange?.provider || "exchangeRateServices",
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

  const normalizedCurrency = String(currency || "").toUpperCase();

  if (!SUPPORTED_CURRENCIES.includes(normalizedCurrency)) {
    return next(new AppError("Unsupported withdrawal currency.", 400));
  }

  if (payoutMethod !== "bank_transfer") {
    return next(
      new AppError(
        "Only bank transfer withdrawals are currently supported.",
        400,
      ),
    );
  }

  let validatedAmount;

  try {
    validatedAmount = validateAmount(amount);
  } catch (error) {
    return next(error);
  }

  const { stringValue, numericValue } = validatedAmount;

  if (numericValue < MINIMUM_WITHDRAWAL[normalizedCurrency]) {
    return next(
      new AppError(
        `Minimum ${normalizedCurrency} withdrawal is ${MINIMUM_WITHDRAWAL[normalizedCurrency]}.`,
        400,
      ),
    );
  }

  if (numericValue > MAXIMUM_WITHDRAWAL[normalizedCurrency]) {
    return next(
      new AppError(
        `Maximum ${normalizedCurrency} withdrawal is ${MAXIMUM_WITHDRAWAL[normalizedCurrency]}.`,
        400,
      ),
    );
  }

  if (!bankDetails || typeof bankDetails !== "object") {
    return next(new AppError("Bank details are required.", 400));
  }

  const bankName = String(bankDetails.bankName || "").trim();
  const bankCode = String(bankDetails.bankCode || "").trim();
  const accountName = String(bankDetails.accountName || "").trim();
  const accountNumber = String(bankDetails.accountNumber || "").trim();

  if (!bankName || !bankCode || !accountName || !accountNumber) {
    return next(
      new AppError(
        "Bank name, bank code, account name, and account number are required.",
        400,
      ),
    );
  }

  // A single wallet is used for all supported payout currencies.
  const wallet = await Wallet.findOne({ user: userId });

  if (!wallet) {
    return next(new AppError("Wallet not found.", 404));
  }

  if (wallet.status !== "active") {
    return next(
      new AppError(
        `Your wallet is currently ${wallet.status}. Withdrawals are not allowed.`,
        403,
      ),
    );
  }

  if ((wallet.baseCurrency || wallet.currency) !== "USD") {
    return next(
      new AppError(
        "Your wallet must use USD accounting before withdrawals can be processed.",
        400,
      ),
    );
  }

  // Prevent simultaneous active withdrawal requests.
  const existingWithdrawal = await Withdrawal.exists({
    user: userId,
    status: { $in: ACTIVE_WITHDRAWAL_STATUSES },
  });

  if (existingWithdrawal) {
    return next(
      new AppError(
        "You already have a withdrawal request being processed.",
        409,
      ),
    );
  }

  // Calculate the USD amount before opening the transaction.

  const {
    walletAmountUsd,
    exchangeRate,
    exchangeRateUpdatedAt,
    exchangeRateProvider,
  } = await convertPayoutToUsd(stringValue, normalizedCurrency);

  const reference = generateWithdrawalReference();
  const session = await mongoose.startSession();

  try {
    let withdrawal;

    await session.withTransaction(async () => {
      // Recheck inside the transaction to reduce race conditions.
      const currentWithdrawal = await Withdrawal.findOne({
        user: userId,
        status: { $in: ACTIVE_WITHDRAWAL_STATUSES },
      }).session(session);

      if (currentWithdrawal) {
        throw new AppError(
          "You already have a withdrawal request being processed.",
          409,
        );
      }

      const currentWallet = await Wallet.findOne({
        _id: wallet._id,
        user: userId,
      }).session(session);

      if (!currentWallet) {
        throw new AppError("Wallet not found.", 404);
      }

      if (currentWallet.status !== "active") {
        throw new AppError("Your wallet is not active.", 403);
      }

      if ((currentWallet.baseCurrency || currentWallet.currency) !== "USD") {
        throw new AppError("Wallet accounting currency must be USD.", 400);
      }

      const created = await Withdrawal.create(
        [
          {
            user: userId,
            wallet: currentWallet._id,
            reference,
            provider: "manual",

            // The amount the user expects to receive.

            amount: mongoose.Types.Decimal128.fromString(stringValue),
            currency: normalizedCurrency,

            walletAmountUsd: toDecimal128(walletAmountUsd),
            walletCurrency: "USD",

            exchangeRate: toDecimal128(exchangeRate),
            exchangeRateUpdatedAt,
            exchangeRateProvider,

            status: "pending",
            payoutMethod,

            bankDetails: {
              bankName,
              bankCode,
              accountName,
              accountNumber,
            },
          },
        ],
        { session },
      );

      withdrawal = created[0];

      // Reserve funds using the reservation service.
      // This updates available/locked balances and creates
      // the reservation within the same transaction.
      await walletReservationService.reserveFunds({
        session,
        userId,
        walletId: currentWallet._id,
        reference,
        amountUsd: walletAmountUsd.toFixed(8),
        metadata: {
          withdrawalId: withdrawal._id.toString(),
          payoutCurrency: normalizedCurrency,
          payoutAmount: stringValue,
        },
      });
    });

    return res.status(201).json({
      status: "success",
      message: "Withdrawal request submitted successfully.",
      data: {
        withdrawal: {
          _id: withdrawal._id,
          reference: withdrawal.reference,
          amount: withdrawal.amount.toString(),
          currency: withdrawal.currency,
          walletAmountUsd: withdrawal.walletAmountUsd.toString(),
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

/*
=====================================================
GET SINGLE WITHDRAWAL - ADMIN
=====================================================
*/

exports.getAdminWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid withdrawal ID.",
      });
    }

    const withdrawal = await Withdrawal.findById(id)
      .select("-providerData")
      .populate(
        "user",
        "name email phone country role status emailVerified referralCode createdAt",
      )
      .populate(
        "wallet",
        "currency availableBalance lockedBalance status lastTransactionAt",
      )
      .populate("reviewedBy", "name email role")
      .populate("processedBy", "name email role")
      .populate(
        "ledgerEntry",
        "type direction amount currency balanceAfter reference description createdAt",
      );

    if (!withdrawal) {
      return res.status(404).json({
        status: "fail",
        message: "Withdrawal not found.",
      });
    }

    /*
     * Never expose the user's full bank account number
     * to the frontend.
     */

    const withdrawalObject = withdrawal.toObject();

    if (withdrawalObject.bankDetails) {
      const accountNumber = withdrawalObject.bankDetails.accountNumber;

      withdrawalObject.bankDetails = {
        ...withdrawalObject.bankDetails,
        accountNumber: accountNumber ? `****${accountNumber.slice(-4)}` : null,
      };
    }

    return res.status(200).json({
      status: "success",
      data: withdrawalObject,
    });
  } catch (error) {
    console.error("GET ADMIN WITHDRAWAL ERROR:", error);

    return res.status(500).json({
      status: "error",
      message: "Unable to fetch withdrawal.",
    });
  }
};

/*
=====================================================
MARK WITHDRAWAL AS UNDER REVIEW
=====================================================
*/

exports.reviewWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewNote } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid withdrawal ID.",
      });
    }

    const withdrawal = await Withdrawal.findById(id);

    if (!withdrawal) {
      return res.status(404).json({
        status: "fail",
        message: "Withdrawal not found.",
      });
    }

    if (withdrawal.status !== "pending") {
      return res.status(400).json({
        status: "fail",
        message: `Withdrawal cannot be reviewed from "${withdrawal.status}" status.`,
      });
    }

    withdrawal.status = "under_review";
    withdrawal.reviewedBy = req.user._id;
    withdrawal.reviewedAt = new Date();
    withdrawal.reviewNote = reviewNote?.trim() || null;

    await withdrawal.save();

    return res.status(200).json({
      status: "success",
      message: "Withdrawal moved to under review.",
      data: withdrawal,
    });
  } catch (error) {
    console.error("REVIEW WITHDRAWAL ERROR:", error);

    return res.status(500).json({
      status: "error",
      message: "Unable to review withdrawal.",
    });
  }
};

/*
=====================================================
APPROVE WITHDRAWAL
=====================================================
*/

exports.approveWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewNote } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid withdrawal ID.",
      });
    }

    const withdrawal = await Withdrawal.findById(id);

    if (!withdrawal) {
      return res.status(404).json({
        status: "fail",
        message: "Withdrawal not found.",
      });
    }

    if (
      withdrawal.status !== "under_review" &&
      withdrawal.status !== "pending"
    ) {
      return res.status(400).json({
        status: "fail",
        message: `Withdrawal cannot be approved from "${withdrawal.status}" status.`,
      });
    }

    withdrawal.status = "approved";

    withdrawal.reviewedBy = req.user._id;
    withdrawal.reviewedAt = new Date();

    if (reviewNote !== undefined) {
      withdrawal.reviewNote = reviewNote?.trim() || null;
    }

    await withdrawal.save();

    return res.status(200).json({
      status: "success",
      message: "Withdrawal approved successfully.",
      data: withdrawal,
    });
  } catch (error) {
    console.error("APPROVE WITHDRAWAL ERROR:", error);

    return res.status(500).json({
      status: "error",
      message: "Unable to approve withdrawal.",
    });
  }
};

/*
=====================================================
REJECT WITHDRAWAL
=====================================================
*/

exports.rejectWithdrawal = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { rejectionReason } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    return next(new AppError("Invalid withdrawal ID.", 400));
  }

  if (typeof rejectionReason !== "string" || !rejectionReason.trim()) {
    return next(new AppError("Rejection reason is required.", 400));
  }

  const session = await mongoose.startSession();

  try {
    let updatedWithdrawal;

    await session.withTransaction(async () => {
      const withdrawal = await Withdrawal.findById(id).session(session);

      if (!withdrawal) {
        throw new AppError("Withdrawal not found.", 404);
      }

      if (!["pending", "under_review"].includes(withdrawal.status)) {
        throw new AppError(
          `Withdrawal cannot be rejected from "${withdrawal.status}" status.`,
          400,
        );
      }

      const reservation = await WalletReservation.findOne({
        reference: withdrawal.reference,
      }).session(session);

      if (!reservation || reservation.status !== "held") {
        throw new AppError(
          "An active wallet reservation could not be found.",
          409,
        );
      }

      await walletReservationService.releaseFunds({
        session,
        reference: withdrawal.reference,
        reason: `Withdrawal rejected: ${rejectionReason.trim()}`,
      });

      withdrawal.status = "rejected";
      withdrawal.rejectionReason = rejectionReason.trim();
      withdrawal.reviewedBy = req.user._id;
      withdrawal.reviewedAt = new Date();

      updatedWithdrawal = await withdrawal.save({ session });
    });

    return res.status(200).json({
      status: "success",
      message: "Withdrawal rejected and reserved funds released.",
      data: { withdrawal: updatedWithdrawal },
    });
  } finally {
    await session.endSession();
  }
});

/*
=====================================================
MARK WITHDRAWAL AS PROCESSING
=====================================================
*/

exports.processWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid withdrawal ID.",
      });
    }

    const withdrawal = await Withdrawal.findById(id);

    if (!withdrawal) {
      return res.status(404).json({
        status: "fail",
        message: "Withdrawal not found.",
      });
    }

    if (withdrawal.status !== "approved") {
      return res.status(400).json({
        status: "fail",
        message: `Only approved withdrawals can be moved to processing. Current status: "${withdrawal.status}".`,
      });
    }

    withdrawal.status = "processing";
    withdrawal.processedBy = req.user._id;
    withdrawal.processedAt = new Date();

    await withdrawal.save();

    return res.status(200).json({
      status: "success",
      message: "Withdrawal moved to processing.",
      data: withdrawal,
    });
  } catch (error) {
    console.error("PROCESS WITHDRAWAL ERROR:", error);

    return res.status(500).json({
      status: "error",
      message: "Unable to process withdrawal.",
    });
  }
};

/*
=====================================================
MARK WITHDRAWAL SUCCESSFUL
=====================================================
*/

exports.markWithdrawalSuccessful = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return next(new AppError("Invalid withdrawal ID.", 400));
  }

  const session = await mongoose.startSession();

  try {
    let updatedWithdrawal;

    await session.withTransaction(async () => {
      const withdrawal = await Withdrawal.findById(id).session(session);

      if (!withdrawal) {
        throw new AppError("Withdrawal not found.", 404);
      }

      // Idempotency: do not consume the same reservation twice.
      if (withdrawal.status === "successful") {
        const reservation = await WalletReservation.findOne({
          reference: withdrawal.reference,
        }).session(session);

        if (
          reservation?.status === "consumed" &&
          withdrawal.ledgerEntry &&
          withdrawal.completedAt
        ) {
          updatedWithdrawal = withdrawal;
          return;
        }

        throw new AppError(
          "Withdrawal is marked successful but its settlement records are inconsistent.",
          409,
        );
      }

      if (withdrawal.status !== "processing") {
        throw new AppError(
          `Withdrawal cannot be completed from "${withdrawal.status}" status.`,
          400,
        );
      }

      const { ledgerEntry } = await walletReservationService.consumeFunds({
        session,
        reference: withdrawal.reference,
        description: `Withdrawal ${withdrawal.reference} completed.`,
        metadata: {
          withdrawalId: withdrawal._id.toString(),
          payoutCurrency: withdrawal.currency,
          payoutAmount: withdrawal.amount.toString(),
          provider: withdrawal.provider,
          providerReference: withdrawal.providerReference || null,
          providerTransactionId: withdrawal.providerTransactionId || null,
        },
      });

      withdrawal.status = "successful";
      withdrawal.completedAt = new Date();
      withdrawal.ledgerEntry = ledgerEntry._id;

      if (!withdrawal.processedBy) {
        withdrawal.processedBy = req.user._id;
      }

      if (!withdrawal.processedAt) {
        withdrawal.processedAt = new Date();
      }

      updatedWithdrawal = await withdrawal.save({ session });
    });

    return res.status(200).json({
      status: "success",
      message: "Withdrawal completed and USD ledger debit recorded.",
      data: { withdrawal: updatedWithdrawal },
    });
  } finally {
    await session.endSession();
  }
});

/*
=====================================================
CANCEL APPROVED WITHDRAWAL
=====================================================
*/

exports.cancelWithdrawal = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { reviewNote } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    return next(new AppError("Invalid withdrawal ID.", 400));
  }

  const session = await mongoose.startSession();

  try {
    let updatedWithdrawal;

    await session.withTransaction(async () => {
      const withdrawal = await Withdrawal.findById(id).session(session);

      if (!withdrawal) {
        throw new AppError("Withdrawal not found.", 404);
      }

      if (withdrawal.status !== "approved") {
        throw new AppError(
          `Withdrawal cannot be cancelled from "${withdrawal.status}" status.`,
          400,
        );
      }

      const reservation = await WalletReservation.findOne({
        reference: withdrawal.reference,
      }).session(session);

      if (!reservation || reservation.status !== "held") {
        throw new AppError(
          "An active wallet reservation could not be found.",
          409,
        );
      }

      await walletReservationService.releaseFunds({
        session,
        reference: withdrawal.reference,
        reason: "Approved withdrawal cancelled by administrator",
      });

      withdrawal.status = "cancelled";
      withdrawal.reviewedBy = req.user._id;
      withdrawal.reviewedAt = new Date();

      if (typeof reviewNote === "string") {
        withdrawal.reviewNote = reviewNote.trim() || null;
      }

      updatedWithdrawal = await withdrawal.save({ session });
    });

    return res.status(200).json({
      status: "success",
      message: "Withdrawal cancelled and reserved funds released.",
      data: { withdrawal: updatedWithdrawal },
    });
  } finally {
    await session.endSession();
  }
});
