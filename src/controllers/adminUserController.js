const User = require("../models/UserModel");
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
