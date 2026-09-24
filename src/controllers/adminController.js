const User = require("../models/UserModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");

// =========================================================
// ADMIN DASHBOARD
// =========================================================

exports.getDashboard = catchAsync(async (req, res, next) => {
  // -------------------------------------------------------
  // USER STATISTICS
  // -------------------------------------------------------

  const [
    totalUsers,
    activeUsers,
    pendingUsers,
    suspendedUsers,
    blockedUsers,
    closedUsers,
    verifiedUsers,
    unverifiedUsers,
    adminUsers,
    twoFactorUsers,
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
      emailVerified: false,
    }),

    User.countDocuments({
      role: "admin",
    }),

    User.countDocuments({
      twoFactorEnabled: true,
    }),
  ]);

  // -------------------------------------------------------
  // KYC STATISTICS
  // -------------------------------------------------------

  const [kycNotSubmitted, kycPending, kycVerified, kycRejected] =
    await Promise.all([
      User.countDocuments({
        kycStatus: "not_submitted",
      }),

      User.countDocuments({
        kycStatus: "pending",
      }),

      User.countDocuments({
        kycStatus: "verified",
      }),

      User.countDocuments({
        kycStatus: "rejected",
      }),
    ]);

  // -------------------------------------------------------
  // RECENT USERS
  // -------------------------------------------------------

  const recentUsers = await User.find()
    .select(
      "name email role status emailVerified kycStatus createdAt lastLoginAt",
    )
    .sort({
      createdAt: -1,
    })
    .limit(10);

  // -------------------------------------------------------
  // RESPONSE
  // -------------------------------------------------------

  res.status(200).json({
    status: "success",

    data: {
      users: {
        total: totalUsers,
        active: activeUsers,
        pending: pendingUsers,
        suspended: suspendedUsers,
        blocked: blockedUsers,
        closed: closedUsers,
        verified: verifiedUsers,
        unverified: unverifiedUsers,
        admins: adminUsers,
        twoFactorEnabled: twoFactorUsers,
      },

      kyc: {
        notSubmitted: kycNotSubmitted,
        pending: kycPending,
        verified: kycVerified,
        rejected: kycRejected,
      },

      recentUsers,
    },
  });
});
