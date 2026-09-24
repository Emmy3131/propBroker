const User = require("../models/UserModel");
const Wallet = require("../models/WalletModel");
const Deposit = require("../models/DepositModel");
const KYC = require("../models/KYCModel");
const LedgerEntry = require("../models/LedgerEntryModel");

const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");

// =========================================================
// GET ALL USERS
// GET /api/v1/admin/users
// =========================================================

exports.getAllUsers = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    search,
    status,
    role,
    kycStatus,
    emailVerified,
  } = req.query;

  // -------------------------------------------------------
  // PAGINATION
  // -------------------------------------------------------

  const currentPage = Math.max(parseInt(page, 10) || 1, 1);

  const perPage = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  const skip = (currentPage - 1) * perPage;

  // -------------------------------------------------------
  // BUILD FILTER
  // -------------------------------------------------------

  const filter = {};

  // -------------------------------------------------------
  // SEARCH
  // -------------------------------------------------------

  if (search && search.trim()) {
    const searchValue = search.trim();

    filter.$or = [
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
      {
        referralCode: {
          $regex: searchValue,
          $options: "i",
        },
      },
    ];
  }

  // -------------------------------------------------------
  // STATUS FILTER
  // -------------------------------------------------------

  if (status) {
    filter.status = status;
  }

  // -------------------------------------------------------
  // ROLE FILTER
  // -------------------------------------------------------

  if (role) {
    filter.role = role;
  }

  // -------------------------------------------------------
  // KYC FILTER
  // -------------------------------------------------------

  if (kycStatus) {
    filter.kycStatus = kycStatus;
  }

  // -------------------------------------------------------
  // EMAIL VERIFICATION FILTER
  // -------------------------------------------------------

  if (emailVerified !== undefined) {
    filter.emailVerified = emailVerified === "true";
  }

  // -------------------------------------------------------
  // FETCH USERS + TOTAL COUNT
  // -------------------------------------------------------

  const [users, totalUsers] = await Promise.all([
    User.find(filter)
      .select(
        [
          "_id",
          "name",
          "email",
          "phone",
          "country",
          "profileImage",
          "role",
          "status",
          "emailVerified",
          "twoFactorEnabled",
          "kycStatus",
          "kycVerifiedAt",
          "referralCode",
          "referredBy",
          "lastLoginAt",
          "lastLoginIp",
          "lastActiveAt",
          "createdAt",
          "updatedAt",
        ].join(" "),
      )
      .populate({
        path: "referredBy",
        select: "name email referralCode",
      })
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(perPage)
      .lean(),

    User.countDocuments(filter),
  ]);

  // -------------------------------------------------------
  // PAGINATION INFORMATION
  // -------------------------------------------------------

  const totalPages = Math.ceil(totalUsers / perPage);

  // -------------------------------------------------------
  // RESPONSE
  // -------------------------------------------------------

  res.status(200).json({
    status: "success",

    results: users.length,

    pagination: {
      totalUsers,
      currentPage,
      perPage,
      totalPages,
      hasNextPage: currentPage < totalPages,
      hasPreviousPage: currentPage > 1,
    },

    data: {
      users,
    },
  });
});

// =========================================================
// GET USER STATISTICS
// GET /api/v1/admin/users/stats
// =========================================================

exports.getUserStats = catchAsync(async (req, res, next) => {
  const [
    totalUsers,
    activeUsers,
    pendingUsers,
    suspendedUsers,
    blockedUsers,
    closedUsers,
    verifiedEmails,
    usersWith2FA,
  ] = await Promise.all([
    User.countDocuments(),

    User.countDocuments({
      status: "active",
    }),

    User.countDocuments({
      status: "pending",
    }),

    User.countDocuments({
      status: "suspended",
    }),

    User.countDocuments({
      status: "blocked",
    }),

    User.countDocuments({
      status: "closed",
    }),

    User.countDocuments({
      emailVerified: true,
    }),

    User.countDocuments({
      twoFactorEnabled: true,
    }),
  ]);

  res.status(200).json({
    status: "success",

    data: {
      totalUsers,
      activeUsers,
      pendingUsers,
      suspendedUsers,
      blockedUsers,
      closedUsers,
      verifiedEmails,
      usersWith2FA,
    },
  });
});

// =========================================================
// GET SINGLE USER
// GET /api/v1/admin/users/:id
// =========================================================

exports.getUser = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id)
    .select(
      [
        "_id",
        "name",
        "email",
        "phone",
        "country",
        "profileImage",
        "role",
        "status",
        "emailVerified",
        "twoFactorEnabled",
        "twoFactorEnabledAt",
        "kycStatus",
        "kycVerifiedAt",
        "referralCode",
        "referredBy",
        "lastLoginAt",
        "lastLoginIp",
        "lastActiveAt",
        "createdAt",
        "updatedAt",
      ].join(" "),
    )
    .populate({
      path: "referredBy",
      select: "name email referralCode",
    })
    .lean();

  if (!user) {
    return next(new AppError("User not found.", 404));
  }

  res.status(200).json({
    status: "success",

    data: {
      user,
    },
  });
});

// =========================================================
// GET COMPLETE USER DETAILS
// GET /api/v1/admin/users/:id/details
// =========================================================

exports.getUserDetails = catchAsync(async (req, res, next) => {
  const userId = req.params.id;

  // -------------------------------------------------------
  // GET USER
  // -------------------------------------------------------

  const user = await User.findById(userId)
    .select(
      [
        "_id",
        "name",
        "email",
        "phone",
        "country",
        "profileImage",
        "role",
        "status",
        "emailVerified",
        "twoFactorEnabled",
        "twoFactorEnabledAt",
        "twoFactorLastUsedAt",
        "kycStatus",
        "kycVerifiedAt",
        "referralCode",
        "referredBy",
        "preferences",
        "lastLoginAt",
        "lastActiveAt",
        "accountClosedAt",
        "createdAt",
        "updatedAt",
      ].join(" "),
    )
    .populate({
      path: "referredBy",
      select: "name email referralCode",
    })
    .lean();

  if (!user) {
    return next(new AppError("User not found.", 404));
  }

  // -------------------------------------------------------
  // GET WALLET
  // -------------------------------------------------------

  const wallet = await Wallet.findOne({
    user: userId,
  }).lean();

  // -------------------------------------------------------
  // GET KYC
  // -------------------------------------------------------
  //
  // We intentionally do NOT return:
  //
  // - identityDocumentNumber
  // - document storageKey
  // - document URLs
  //
  // The KYC page has a separate secure document endpoint.
  // -------------------------------------------------------

  const kyc = await KYC.findOne({
    user: userId,
  })
    .select(
      [
        "_id",
        "user",
        "status",
        "firstName",
        "lastName",
        "dateOfBirth",
        "country",
        "address",
        "city",
        "state",
        "postalCode",
        "identityDocumentType",
        "rejectionReason",
        "reviewNote",
        "reviewedBy",
        "reviewedAt",
        "submittedAt",
        "verifiedAt",
        "rejectedAt",
        "createdAt",
        "updatedAt",
      ].join(" "),
    )
    .populate({
      path: "reviewedBy",
      select: "name email",
    })
    .lean();

  // -------------------------------------------------------
  // DEPOSIT STATISTICS
  // -------------------------------------------------------

  const [
    totalDeposits,
    successfulDeposits,
    pendingDeposits,
    processingDeposits,
    failedDeposits,
    cancelledDeposits,
    expiredDeposits,
  ] = await Promise.all([
    Deposit.countDocuments({
      user: userId,
    }),

    Deposit.countDocuments({
      user: userId,
      status: "successful",
    }),

    Deposit.countDocuments({
      user: userId,
      status: "pending",
    }),

    Deposit.countDocuments({
      user: userId,
      status: "processing",
    }),

    Deposit.countDocuments({
      user: userId,
      status: "failed",
    }),

    Deposit.countDocuments({
      user: userId,
      status: "cancelled",
    }),

    Deposit.countDocuments({
      user: userId,
      status: "expired",
    }),
  ]);

  // -------------------------------------------------------
  // DEPOSIT VOLUME BY CURRENCY
  // -------------------------------------------------------

  const depositVolume = await Deposit.aggregate([
    {
      $match: {
        user: user._id,
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

    {
      $sort: {
        _id: 1,
      },
    },
  ]);

  // -------------------------------------------------------
  // FORMAT DEPOSIT VOLUME
  // -------------------------------------------------------

  const depositVolumeByCurrency = {
    USD: "0",
    NGN: "0",
    CAD: "0",
    EUR: "0",
  };

  depositVolume.forEach((item) => {
    if (item._id) {
      depositVolumeByCurrency[item._id] = item.total?.toString() || "0";
    }
  });

  // -------------------------------------------------------
  // RECENT DEPOSITS
  // -------------------------------------------------------

  const recentDeposits = await Deposit.find({
    user: userId,
  })
    .select(
      [
        "_id",
        "wallet",
        "provider",
        "reference",
        "providerTransactionId",
        "providerReference",
        "amount",
        "currency",
        "status",
        "verifiedAt",
        "verificationMethod",
        "creditedAt",
        "ledgerEntry",
        "failureReason",
        "expiresAt",
        "createdAt",
        "updatedAt",
      ].join(" "),
    )
    .sort({
      createdAt: -1,
    })
    .limit(20)
    .lean();

  // -------------------------------------------------------
  // LEDGER HISTORY
  // -------------------------------------------------------

  const ledgerEntries = await LedgerEntry.find({
    user: userId,
  })
    .select(
      [
        "_id",
        "wallet",
        "user",
        "type",
        "direction",
        "amount",
        "currency",
        "balanceAfter",
        "reference",
        "description",
        "metadata",
        "createdAt",
      ].join(" "),
    )
    .sort({
      createdAt: -1,
    })
    .limit(30)
    .lean();

  // -------------------------------------------------------
  // REFERRAL INFORMATION
  // -------------------------------------------------------

  const totalReferredUsers = await User.countDocuments({
    referredBy: user._id,
  });

  // -------------------------------------------------------
  // RESPONSE
  // -------------------------------------------------------

  res.status(200).json({
    status: "success",

    data: {
      // ---------------------------------------------------
      // USER
      // ---------------------------------------------------

      user,

      // ---------------------------------------------------
      // SECURITY
      // ---------------------------------------------------

      security: {
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        twoFactorEnabledAt: user.twoFactorEnabledAt,
        twoFactorLastUsedAt: user.twoFactorLastUsedAt,
        lastLoginAt: user.lastLoginAt,
        lastActiveAt: user.lastActiveAt,
      },

      // ---------------------------------------------------
      // KYC
      // ---------------------------------------------------

      kyc,

      // ---------------------------------------------------
      // WALLET
      // ---------------------------------------------------

      wallet: wallet || null,

      // ---------------------------------------------------
      // DEPOSITS
      // ---------------------------------------------------

      deposits: {
        summary: {
          totalDeposits,
          successfulDeposits,
          pendingDeposits,
          processingDeposits,
          failedDeposits,
          cancelledDeposits,
          expiredDeposits,
        },

        volumeByCurrency: depositVolumeByCurrency,

        recent: recentDeposits,
      },

      // ---------------------------------------------------
      // LEDGER
      // ---------------------------------------------------

      ledger: {
        recent: ledgerEntries,
      },

      // ---------------------------------------------------
      // REFERRALS
      // ---------------------------------------------------

      referrals: {
        referralCode: user.referralCode || null,

        referredBy: user.referredBy || null,

        totalReferredUsers,
      },

      // ---------------------------------------------------
      // WITHDRAWALS
      // ---------------------------------------------------

      withdrawals: {
        available: false,

        message: "Withdrawal functionality has not been implemented yet.",
      },

      // ---------------------------------------------------
      // TRADING
      // ---------------------------------------------------

      trading: {
        available: false,

        message: "Trading functionality has not been implemented yet.",
      },
    },
  });
});
