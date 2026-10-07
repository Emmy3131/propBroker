const mongoose = require("mongoose");

const Deposit = require("../models/DepositModel");
const Wallet = require("../models/WalletModel");
const User = require("../models/UserModel");
const PaymentMethod = require("../models/PaymentModel");

const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");

const { generateDepositReference } = require("../utils/depositReference");

const {
  getWalletForUser,
  createWalletForUser,
  creditWallet,
} = require("../services/walletServices");

/*
=====================================================
SUPPORTED VALUES
=====================================================
*/

const SUPPORTED_CURRENCIES = ["USD", "NGN", "CAD", "EUR"];

const SUPPORTED_PAYMENT_TYPES = [
  "bank_transfer",
  "crypto",
  "mobile_money",
  "other",
];

const DEPOSIT_STATUSES = [
  "pending",
  "submitted",
  "under_review",
  "processing",
  "successful",
  "rejected",
  "cancelled",
  "expired",
];

/*
=====================================================
VALIDATE OBJECT ID
=====================================================
*/

const validateObjectId = (id, fieldName = "ID") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${fieldName}.`, 400);
  }
};

/*
=====================================================
VALIDATE AMOUNT
=====================================================
*/

const validateDepositAmount = (amount) => {
  if (amount === undefined || amount === null || amount === "") {
    throw new AppError("Deposit amount is required.", 400);
  }

  const value = String(amount).trim();

  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new AppError("Invalid deposit amount.", 400);
  }

  const decimalPlaces = value.includes(".") ? value.split(".")[1].length : 0;

  if (decimalPlaces > 8) {
    throw new AppError(
      "Deposit amount cannot contain more than 8 decimal places.",
      400,
    );
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new AppError("Deposit amount must be greater than zero.", 400);
  }

  return value;
};

/*
=====================================================
CREATE DEPOSIT
=====================================================

Creates a pending deposit.

IMPORTANT:
Creating the deposit DOES NOT credit the wallet.

The user must:
1. See the payment instructions
2. Make the payment externally
3. Submit payment proof
4. Wait for admin approval
=====================================================
*/

exports.createDeposit = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  const {
    amount,
    currency = "NGN",
    paymentMethodId,
    paymentAsset = null,
    paymentNetwork = null,
    userNote = null,
  } = req.body;

  const normalizedCurrency = String(currency).toUpperCase();

  /*
  =====================================================
  1. VALIDATE CURRENCY
  =====================================================
  */

  if (!SUPPORTED_CURRENCIES.includes(normalizedCurrency)) {
    return next(
      new AppError(
        `Unsupported deposit currency. Supported currencies are ${SUPPORTED_CURRENCIES.join(
          ", ",
        )}.`,
        400,
      ),
    );
  }

  /*
  =====================================================
  2. VALIDATE PAYMENT METHOD
  =====================================================
  */

  if (!paymentMethodId) {
    return next(new AppError("Payment method is required.", 400));
  }

  validateObjectId(paymentMethodId, "payment method ID");

  /*
  =====================================================
  3. VALIDATE AMOUNT
  =====================================================
  */

  let amountString;

  try {
    amountString = validateDepositAmount(amount);
  } catch (error) {
    return next(error);
  }

  /*
  =====================================================
  4. FIND PAYMENT METHOD
  =====================================================
  */

  const paymentMethod = await PaymentMethod.findOne({
    _id: paymentMethodId,
    status: "active",
  }).lean();

  if (!paymentMethod) {
    return next(
      new AppError("The selected payment method is no longer available.", 404),
    );
  }

  /*
  =====================================================
  5. PAYMENT METHOD CURRENCY MUST MATCH DEPOSIT
  =====================================================
  */

  if (paymentMethod.currency !== normalizedCurrency) {
    return next(
      new AppError(
        `This payment method accepts ${paymentMethod.currency}, not ${normalizedCurrency}.`,
        400,
      ),
    );
  }

  /*
  =====================================================
  6. VALIDATE PAYMENT TYPE
  =====================================================
  */

  if (!SUPPORTED_PAYMENT_TYPES.includes(paymentMethod.type)) {
    return next(new AppError("Invalid payment method type.", 400));
  }

  /*
  =====================================================
  7. FIND OR CREATE USER WALLET
  =====================================================
  */

  let wallet = await getWalletForUser(userId, normalizedCurrency);

  if (!wallet) {
    wallet = await createWalletForUser(userId, normalizedCurrency);
  }

  if (!wallet) {
    return next(
      new AppError(
        `Unable to create or find your ${normalizedCurrency} wallet.`,
        500,
      ),
    );
  }

  /*
  =====================================================
  8. CHECK WALLET STATUS
  =====================================================
  */

  if (wallet.status !== "active") {
    return next(
      new AppError(
        `Your ${normalizedCurrency} wallet is currently ${wallet.status}. Deposits are not allowed.`,
        403,
      ),
    );
  }

  /*
  =====================================================
  9. CREATE INTERNAL REFERENCE
  =====================================================
  */

  const reference = generateDepositReference();

  /*
  =====================================================
  10. CREATE PENDING DEPOSIT
  =====================================================
  */

  const deposit = await Deposit.create({
    user: userId,
    wallet: wallet._id,

    paymentMethod: paymentMethod._id,

    paymentType: paymentMethod.type,

    reference,

    paymentAsset: paymentAsset
      ? String(paymentAsset).trim().toUpperCase()
      : null,

    paymentNetwork: paymentNetwork ? String(paymentNetwork).trim() : null,

    amount: mongoose.Types.Decimal128.fromString(amountString),

    currency: normalizedCurrency,

    userNote: userNote ? String(userNote).trim() : null,

    status: "pending",
  });

  /*
  =====================================================
  11. RESPONSE
  =====================================================
  */

  return res.status(201).json({
    status: "success",

    message:
      "Deposit request created successfully. Please make your payment using the provided payment instructions.",

    data: {
      depositId: deposit._id,

      reference: deposit.reference,

      amount: deposit.amount.toString(),

      currency: deposit.currency,

      status: deposit.status,

      paymentMethod: {
        id: paymentMethod._id,
        name: paymentMethod.name,
        type: paymentMethod.type,
        currency: paymentMethod.currency,

        bankName: paymentMethod.bankName || null,
        accountName: paymentMethod.accountName || null,
        accountNumber: paymentMethod.accountNumber || null,
        routingNumber: paymentMethod.routingNumber || null,
        iban: paymentMethod.iban || null,
        swiftCode: paymentMethod.swiftCode || null,

        network: paymentMethod.network || null,
        walletAddress: paymentMethod.walletAddress || null,

        instructions: paymentMethod.instructions || null,
      },
    },
  });
});

/*
=====================================================
SUBMIT PAYMENT
=====================================================

Called after the user has actually made the payment.

This changes:

pending
      ↓
submitted

It DOES NOT credit the wallet.
=====================================================
*/

exports.submitPayment = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  const {
    transactionReference,
    paymentProof,
    userNote,
    paymentAsset,
    paymentNetwork,
  } = req.body;

  const { id } = req.params;

  validateObjectId(id, "deposit ID");

  /*
  =====================================================
  1. FIND USER DEPOSIT
  =====================================================
  */

  const deposit = await Deposit.findOne({
    _id: id,
    user: userId,
  });

  if (!deposit) {
    return next(new AppError("Deposit not found.", 404));
  }

  /*
  =====================================================
  2. CHECK STATUS
  =====================================================
  */

  if (deposit.status !== "pending") {
    return next(
      new AppError(
        `This deposit cannot be submitted because its current status is ${deposit.status}.`,
        400,
      ),
    );
  }

  /*
  =====================================================
  3. TRANSACTION REFERENCE
  =====================================================
  */

  if (
    transactionReference !== undefined &&
    transactionReference !== null &&
    String(transactionReference).trim()
  ) {
    deposit.transactionReference = String(transactionReference).trim();
  }

  /*
  =====================================================
  4. PAYMENT PROOF
  =====================================================
  */

  if (paymentProof) {
    if (typeof paymentProof !== "object") {
      return next(new AppError("Payment proof must be a valid object.", 400));
    }

    deposit.paymentProof = {
      url: paymentProof.url ? String(paymentProof.url).trim() : null,

      publicId: paymentProof.publicId
        ? String(paymentProof.publicId).trim()
        : null,

      fileName: paymentProof.fileName
        ? String(paymentProof.fileName).trim()
        : null,

      mimeType: paymentProof.mimeType
        ? String(paymentProof.mimeType).trim()
        : null,

      uploadedAt: new Date(),
    };
  }

  /*
  =====================================================
  5. USER NOTE
  =====================================================
  */

  if (userNote !== undefined && userNote !== null) {
    deposit.userNote = String(userNote).trim();
  }

  /*
  =====================================================
  6. PAYMENT ASSET
  =====================================================
  */

  if (paymentAsset !== undefined && paymentAsset !== null) {
    deposit.paymentAsset = String(paymentAsset).trim().toUpperCase();
  }

  /*
  =====================================================
  7. PAYMENT NETWORK
  =====================================================
  */

  if (paymentNetwork !== undefined && paymentNetwork !== null) {
    deposit.paymentNetwork = String(paymentNetwork).trim();
  }

  /*
  =====================================================
  8. SUBMIT
  =====================================================
  */

  deposit.status = "submitted";
  deposit.paymentSubmittedAt = new Date();

  await deposit.save();

  /*
  =====================================================
  9. RESPONSE
  =====================================================
  */

  res.status(200).json({
    status: "success",

    message:
      "Payment submitted successfully. Your deposit is now awaiting admin review.",

    data: {
      depositId: deposit._id,
      reference: deposit.reference,
      amount: deposit.amount.toString(),
      currency: deposit.currency,
      status: deposit.status,
      paymentSubmittedAt: deposit.paymentSubmittedAt,
    },
  });
});

/*
=====================================================
GET ACTIVE PAYMENT METHODS FOR DEPOSIT
=====================================================

This is useful for the user deposit page.
=====================================================
*/

exports.getDepositPaymentMethods = catchAsync(async (req, res) => {
  const currency = req.query.currency
    ? String(req.query.currency).toUpperCase()
    : null;

  const filter = {
    status: "active",
  };

  if (currency) {
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      throw new AppError("Invalid currency.", 400);
    }

    filter.currency = currency;
  }

  const paymentMethods = await PaymentMethod.find(filter)
    .select(
      "name type currency bankName accountName accountNumber routingNumber iban swiftCode network walletAddress instructions displayOrder",
    )
    .sort({
      displayOrder: 1,
      createdAt: 1,
    })
    .lean();

  res.status(200).json({
    status: "success",
    results: paymentMethods.length,
    data: {
      paymentMethods,
    },
  });
});

/*
=====================================================
GET MY DEPOSITS
=====================================================
*/

exports.getMyDeposits = catchAsync(async (req, res, next) => {
  const page = Math.max(Number(req.query.page) || 1, 1);

  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

  const skip = (page - 1) * limit;

  const filter = {
    user: req.user._id,
  };

  if (req.query.status) {
    const status = String(req.query.status).toLowerCase();

    if (!DEPOSIT_STATUSES.includes(status)) {
      return next(new AppError("Invalid deposit status.", 400));
    }

    filter.status = status;
  }

  const [deposits, total] = await Promise.all([
    Deposit.find(filter)
      .populate({
        path: "paymentMethod",
        select:
          "name type currency bankName accountName accountNumber network walletAddress instructions",
      })
      .populate({
        path: "wallet",
        select: "currency availableBalance lockedBalance status",
      })
      .populate({
        path: "ledgerEntry",
        select:
          "type direction amount currency balanceAfter reference description createdAt",
      })
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    Deposit.countDocuments(filter),
  ]);

  res.status(200).json({
    status: "success",

    results: deposits.length,

    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },

    data: {
      deposits,
    },
  });
});

/*
=====================================================
GET MY SINGLE DEPOSIT
=====================================================
*/

exports.getMyDeposit = catchAsync(async (req, res, next) => {
  validateObjectId(req.params.id, "deposit ID");

  const deposit = await Deposit.findOne({
    _id: req.params.id,
    user: req.user._id,
  })
    .populate({
      path: "paymentMethod",
      select:
        "name type currency bankName accountName accountNumber routingNumber iban swiftCode network walletAddress instructions",
    })
    .populate({
      path: "wallet",
      select: "currency availableBalance lockedBalance status",
    })
    .populate({
      path: "ledgerEntry",
      select:
        "type direction amount currency balanceAfter reference description metadata createdAt",
    })
    .lean();

  if (!deposit) {
    return next(new AppError("Deposit not found.", 404));
  }

  res.status(200).json({
    status: "success",

    data: {
      deposit,
    },
  });
});

/*
=====================================================
GET MY DEPOSIT BY REFERENCE
=====================================================
*/

exports.getMyDepositByReference = catchAsync(async (req, res, next) => {
  const { reference } = req.params;

  if (!reference) {
    return next(new AppError("Deposit reference is required.", 400));
  }

  const deposit = await Deposit.findOne({
    reference,
    user: req.user._id,
  })
    .populate({
      path: "paymentMethod",
      select:
        "name type currency bankName accountName accountNumber routingNumber iban swiftCode network walletAddress instructions",
    })
    .populate({
      path: "wallet",
      select: "currency availableBalance lockedBalance status",
    })
    .lean();

  if (!deposit) {
    return next(new AppError("Deposit not found.", 404));
  }

  res.status(200).json({
    status: "success",

    data: {
      deposit,
    },
  });
});

/*
=====================================================
ADMIN - GET ALL DEPOSITS
=====================================================
*/

exports.getAdminDeposits = catchAsync(async (req, res, next) => {
  const page = Math.max(Number(req.query.page) || 1, 1);

  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

  const skip = (page - 1) * limit;

  const { search, status, currency, paymentType } = req.query;

  const filter = {};

  /*
    -------------------------------------------------
    STATUS
    -------------------------------------------------
    */

  if (status && status !== "all") {
    const normalizedStatus = String(status).toLowerCase();

    if (!DEPOSIT_STATUSES.includes(normalizedStatus)) {
      return next(new AppError("Invalid deposit status.", 400));
    }

    filter.status = normalizedStatus;
  }

  /*
    -------------------------------------------------
    CURRENCY
    -------------------------------------------------
    */

  if (currency && currency !== "all") {
    const normalizedCurrency = String(currency).toUpperCase();

    if (!SUPPORTED_CURRENCIES.includes(normalizedCurrency)) {
      return next(new AppError("Invalid currency.", 400));
    }

    filter.currency = normalizedCurrency;
  }

  /*
    -------------------------------------------------
    PAYMENT TYPE
    -------------------------------------------------
    */

  if (paymentType && paymentType !== "all") {
    const normalizedPaymentType = String(paymentType).toLowerCase();

    if (!SUPPORTED_PAYMENT_TYPES.includes(normalizedPaymentType)) {
      return next(new AppError("Invalid payment type.", 400));
    }

    filter.paymentType = normalizedPaymentType;
  }

  /*
    -------------------------------------------------
    SEARCH
    -------------------------------------------------
    */

  if (search && search.trim()) {
    const searchValue = search.trim();

    const users = await User.find({
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
      ],
    })
      .select("_id")
      .lean();

    const userIds = users.map((user) => user._id);

    filter.$or = [
      {
        reference: {
          $regex: searchValue,
          $options: "i",
        },
      },

      {
        transactionReference: {
          $regex: searchValue,
          $options: "i",
        },
      },
    ];

    if (userIds.length > 0) {
      filter.$or.push({
        user: {
          $in: userIds,
        },
      });
    }
  }

  /*
    -------------------------------------------------
    QUERY
    -------------------------------------------------
    */

  const [deposits, totalDeposits] = await Promise.all([
    Deposit.find(filter)
      .populate({
        path: "user",
        select: "name email phone country role status",
      })
      .populate({
        path: "wallet",
        select: "currency availableBalance lockedBalance status",
      })
      .populate({
        path: "paymentMethod",
        select:
          "name type currency bankName accountName accountNumber network walletAddress",
      })
      .populate({
        path: "reviewedBy",
        select: "name email role",
      })
      .populate({
        path: "approvedBy",
        select: "name email role",
      })
      .populate({
        path: "rejectedBy",
        select: "name email role",
      })
      .populate({
        path: "ledgerEntry",
        select:
          "type direction amount currency balanceAfter reference description metadata createdAt",
      })
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    Deposit.countDocuments(filter),
  ]);

  /*
    -------------------------------------------------
    SUMMARY
    -------------------------------------------------
    */

  const [
    totalCount,
    pendingCount,
    submittedCount,
    reviewCount,
    successfulCount,
    rejectedCount,
    cancelledCount,
    expiredCount,
  ] = await Promise.all([
    Deposit.countDocuments(filter),

    Deposit.countDocuments({
      ...filter,
      status: "pending",
    }),

    Deposit.countDocuments({
      ...filter,
      status: "submitted",
    }),

    Deposit.countDocuments({
      ...filter,
      status: "under_review",
    }),

    Deposit.countDocuments({
      ...filter,
      status: "successful",
    }),

    Deposit.countDocuments({
      ...filter,
      status: "rejected",
    }),

    Deposit.countDocuments({
      ...filter,
      status: "cancelled",
    }),

    Deposit.countDocuments({
      ...filter,
      status: "expired",
    }),
  ]);

  /*
    -------------------------------------------------
    SUCCESSFUL VOLUME
    -------------------------------------------------
    */

  const volumeAggregation = await Deposit.aggregate([
    {
      $match: {
        ...filter,
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

  volumeAggregation.forEach((item) => {
    if (item._id) {
      volumeByCurrency[item._id] = item.total?.toString() || "0";
    }
  });

  res.status(200).json({
    status: "success",

    results: deposits.length,

    pagination: {
      total: totalDeposits,
      page,
      limit,
      pages: Math.ceil(totalDeposits / limit),
    },

    data: {
      deposits,

      summary: {
        totalDeposits: totalCount,
        pendingDeposits: pendingCount,
        submittedDeposits: submittedCount,
        underReviewDeposits: reviewCount,
        successfulDeposits: successfulCount,
        rejectedDeposits: rejectedCount,
        cancelledDeposits: cancelledCount,
        expiredDeposits: expiredCount,
      },

      volumeByCurrency,
    },
  });
});

/*
=====================================================
ADMIN - GET SINGLE DEPOSIT
=====================================================
*/

exports.getAdminDeposit = catchAsync(async (req, res, next) => {
  validateObjectId(req.params.id, "deposit ID");

  const deposit = await Deposit.findById(req.params.id)
    .populate({
      path: "user",
      select:
        "name email phone country role status emailVerified twoFactorEnabled kycStatus referralCode createdAt",
    })
    .populate({
      path: "wallet",
      select:
        "user currency availableBalance lockedBalance status lastTransactionAt createdAt updatedAt",
    })
    .populate({
      path: "paymentMethod",
    })
    .populate({
      path: "reviewedBy",
      select: "name email role",
    })
    .populate({
      path: "approvedBy",
      select: "name email role",
    })
    .populate({
      path: "rejectedBy",
      select: "name email role",
    })
    .populate({
      path: "ledgerEntry",
      select:
        "wallet user type direction amount currency balanceAfter reference description metadata createdAt",
    })
    .lean();

  if (!deposit) {
    return next(new AppError("Deposit not found.", 404));
  }

  res.status(200).json({
    status: "success",

    data: {
      deposit,
    },
  });
});

/*
=====================================================
ADMIN - MARK UNDER REVIEW
=====================================================

submitted → under_review
=====================================================
*/

exports.reviewDeposit = catchAsync(async (req, res, next) => {
  validateObjectId(req.params.id, "deposit ID");

  const deposit = await Deposit.findById(req.params.id);

  if (!deposit) {
    return next(new AppError("Deposit not found.", 404));
  }

  if (!["submitted", "pending"].includes(deposit.status)) {
    return next(
      new AppError(
        `Deposit cannot be moved to review from ${deposit.status}.`,
        400,
      ),
    );
  }

  deposit.status = "under_review";

  deposit.reviewedBy = req.user._id;

  deposit.reviewedAt = new Date();

  await deposit.save();

  res.status(200).json({
    status: "success",

    message: "Deposit moved to under review.",

    data: {
      depositId: deposit._id,
      reference: deposit.reference,
      status: deposit.status,
      reviewedBy: deposit.reviewedBy,
      reviewedAt: deposit.reviewedAt,
    },
  });
});

/*
=====================================================
ADMIN - REJECT DEPOSIT
=====================================================
*/

exports.rejectDeposit = catchAsync(async (req, res, next) => {
  validateObjectId(req.params.id, "deposit ID");

  const { rejectionReason, adminNote = null } = req.body;

  if (!rejectionReason || !String(rejectionReason).trim()) {
    return next(new AppError("A rejection reason is required.", 400));
  }

  const deposit = await Deposit.findById(req.params.id);

  if (!deposit) {
    return next(new AppError("Deposit not found.", 404));
  }

  /*
    -------------------------------------------------
    NEVER REJECT A SUCCESSFUL DEPOSIT
    -------------------------------------------------
    */

  if (deposit.status === "successful") {
    return next(new AppError("A successful deposit cannot be rejected.", 400));
  }

  /*
    -------------------------------------------------
    ONLY PENDING / SUBMITTED / REVIEW
    -------------------------------------------------
    */

  if (!["pending", "submitted", "under_review"].includes(deposit.status)) {
    return next(
      new AppError(`Deposit cannot be rejected from ${deposit.status}.`, 400),
    );
  }

  deposit.status = "rejected";

  deposit.rejectedBy = req.user._id;

  deposit.rejectedAt = new Date();

  deposit.reviewedBy = deposit.reviewedBy || req.user._id;

  deposit.reviewedAt = deposit.reviewedAt || new Date();

  deposit.rejectionReason = String(rejectionReason).trim();

  if (adminNote !== null) {
    deposit.adminNote = String(adminNote).trim();
  }

  await deposit.save();

  res.status(200).json({
    status: "success",

    message: "Deposit rejected successfully.",

    data: {
      depositId: deposit._id,
      reference: deposit.reference,
      status: deposit.status,
      rejectionReason: deposit.rejectionReason,
      rejectedBy: deposit.rejectedBy,
      rejectedAt: deposit.rejectedAt,
    },
  });
});

/*
=====================================================
ADMIN - APPROVE DEPOSIT
=====================================================

IMPORTANT:

This function deliberately stops before creditWallet()
until we confirm your wallet service signature.

DO NOT manually update availableBalance here.

Wallet credits must go through the wallet service so
the ledger remains the source of financial truth.
=====================================================
*/

exports.approveDeposit = catchAsync(async (req, res, next) => {
  validateObjectId(req.params.id, "deposit ID");

  const { adminNote = null } = req.body;

  /*
    =====================================================
    1. ATOMICALLY CLAIM THE DEPOSIT
    =====================================================

    Only one admin request can successfully change:

    submitted / under_review
                ↓
            processing

    This prevents two simultaneous approval requests
    from both reaching creditWallet().
    =====================================================
    */

  const deposit = await Deposit.findOneAndUpdate(
    {
      _id: req.params.id,

      status: {
        $in: ["submitted", "under_review"],
      },
    },

    {
      $set: {
        status: "processing",

        reviewedBy: req.user._id,

        reviewedAt: new Date(),

        adminNote: adminNote !== null ? String(adminNote).trim() : null,
      },
    },

    {
      new: true,
      runValidators: true,
    },
  );

  /*
    =====================================================
    2. DEPOSIT WAS NOT AVAILABLE FOR APPROVAL
    =====================================================
    */

  if (!deposit) {
    const existingDeposit = await Deposit.findById(req.params.id).select(
      "status reference",
    );

    if (!existingDeposit) {
      return next(new AppError("Deposit not found.", 404));
    }

    if (existingDeposit.status === "successful") {
      return next(
        new AppError(
          "This deposit has already been approved and credited.",
          409,
        ),
      );
    }

    if (existingDeposit.status === "processing") {
      return next(
        new AppError(
          "This deposit is already being processed by another approval request.",
          409,
        ),
      );
    }

    return next(
      new AppError(
        `Deposit cannot be approved from its current status: ${existingDeposit.status}.`,
        400,
      ),
    );
  }

  /*
    =====================================================
    3. VERIFY WALLET
    =====================================================
    */

  const wallet = await Wallet.findById(deposit.wallet);

  if (!wallet) {
    /*
      -----------------------------------------------
      IMPORTANT

      If the wallet disappeared after the deposit
      was created, return the deposit to review.

      We do NOT want the deposit permanently stuck
      in processing.
      -----------------------------------------------
      */

    await Deposit.findByIdAndUpdate(deposit._id, {
      $set: {
        status: "under_review",
      },
    });

    return next(
      new AppError(
        "The wallet associated with this deposit could not be found.",
        404,
      ),
    );
  }

  /*
    =====================================================
    4. VERIFY WALLET STATUS
    =====================================================
    */

  if (wallet.status !== "active") {
    await Deposit.findByIdAndUpdate(deposit._id, {
      $set: {
        status: "under_review",
      },
    });

    return next(
      new AppError(
        `The user's ${wallet.currency} wallet is currently ${wallet.status}.`,
        403,
      ),
    );
  }

  /*
    =====================================================
    5. VERIFY WALLET CURRENCY
    =====================================================
    */

  if (wallet.currency !== deposit.currency) {
    await Deposit.findByIdAndUpdate(deposit._id, {
      $set: {
        status: "under_review",
      },
    });

    return next(
      new AppError("Deposit currency does not match the wallet currency.", 400),
    );
  }

  /*
    =====================================================
    6. CREDIT WALLET
    =====================================================

    Your wallet service handles:

    availableBalance += amount

    AND

    LedgerEntry creation

    inside its own MongoDB transaction.
    =====================================================
    */

  let creditResult;

  try {
    creditResult = await creditWallet({
      userId: deposit.user,

      amount: deposit.amount.toString(),

      type: "DEPOSIT",

      currency: deposit.currency,

      /*
          IMPORTANT:

          Use the deposit's internal reference as
          the financial transaction reference.
          */

      reference: deposit.reference,

      description: `Manual deposit approved: ${deposit.reference}`,

      metadata: {
        depositId: deposit._id.toString(),

        paymentMethodId: deposit.paymentMethod
          ? deposit.paymentMethod.toString()
          : null,

        paymentType: deposit.paymentType,

        transactionReference: deposit.transactionReference,

        approvedBy: req.user._id.toString(),
      },
    });
  } catch (error) {
    /*
      =================================================
      CREDIT FAILED
      =================================================

      Return the deposit to under_review so an admin
      can investigate/retry it.

      Do NOT mark it successful.
      =================================================
      */

    await Deposit.findByIdAndUpdate(deposit._id, {
      $set: {
        status: "under_review",

        failureReason: error.message || "Wallet credit failed.",
      },
    });

    return next(error);
  }

  /*
    =====================================================
    7. MAKE SURE LEDGER ENTRY WAS CREATED
    =====================================================
    */

  if (!creditResult || !creditResult.ledgerEntry) {
    /*
      This should never happen because creditWallet()
      creates the ledger entry as part of its transaction.
      */

    await Deposit.findByIdAndUpdate(deposit._id, {
      $set: {
        status: "under_review",

        failureReason: "Wallet was credited but no ledger entry was returned.",
      },
    });

    return next(
      new AppError(
        "Deposit credit completed without a ledger entry. Manual investigation is required.",
        500,
      ),
    );
  }

  /*
    =====================================================
    8. MARK DEPOSIT SUCCESSFUL
    =====================================================
    */

  const successfulDeposit = await Deposit.findOneAndUpdate(
    {
      _id: deposit._id,

      /*
          Make sure nobody changed the deposit while
          the wallet credit was happening.
          */

      status: "processing",
    },

    {
      $set: {
        status: "successful",

        approvedBy: req.user._id,

        approvedAt: new Date(),

        creditedAt: new Date(),

        ledgerEntry: creditResult.ledgerEntry._id,

        creditReference: deposit.reference,

        reviewedBy: deposit.reviewedBy || req.user._id,

        reviewedAt: deposit.reviewedAt || new Date(),

        failureReason: null,
      },
    },

    {
      new: true,
      runValidators: true,
    },
  );

  /*
    =====================================================
    9. FINAL SAFETY CHECK
    =====================================================
    */

  if (!successfulDeposit) {
    return next(
      new AppError(
        "Wallet credit completed, but the deposit status could not be finalized. Manual investigation is required.",
        500,
      ),
    );
  }

  /*
    =====================================================
    10. RESPONSE
    =====================================================
    */

  return res.status(200).json({
    status: "success",

    message:
      "Deposit approved successfully and the user's wallet has been credited.",

    data: {
      depositId: successfulDeposit._id,

      reference: successfulDeposit.reference,

      amount: successfulDeposit.amount.toString(),

      currency: successfulDeposit.currency,

      status: successfulDeposit.status,

      walletId: deposit.wallet,

      ledgerEntryId: creditResult.ledgerEntry._id,

      approvedBy: successfulDeposit.approvedBy,

      approvedAt: successfulDeposit.approvedAt,

      creditedAt: successfulDeposit.creditedAt,
    },
  });
});

/*
=====================================================
EXPORT CONSTANTS
=====================================================
*/

exports.SUPPORTED_CURRENCIES = SUPPORTED_CURRENCIES;

exports.SUPPORTED_PAYMENT_TYPES = SUPPORTED_PAYMENT_TYPES;

exports.DEPOSIT_STATUSES = DEPOSIT_STATUSES;
