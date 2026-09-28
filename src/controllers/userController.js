const mongoose = require("mongoose");

const User = require("../models/UserModel");
const Wallet = require("../models/WalletModel");
const Deposit = require("../models/DepositModel");
const Withdrawal = require("../models/WithdrawalModel");

exports.createUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const newUser = await User.create({ name, email, password });
    res.status(201).json({
      status: "success",
      data: {
        user: newUser,
      },
    });
  } catch (error) {
    res.status(400).json({
      status: "fail",
      message: "User creation failed: " + error.message,
    });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).json({
      status: "success",
      results: users.length,
      data: {
        users,
      },
    });
  } catch (error) {
    res.status(400).json({
      status: "fail",
      message: error.message,
    });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "User not found",
      });
    }
    res.status(200).json({
      status: "success",
      data: {
        user,
      },
    });
  } catch (error) {
    res.status(400).json({
      status: "fail",
      message: error.message,
    });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "User not found",
      });
    }
    res.status(200).json({
      status: "success",
      data: {
        user,
      },
    });
  } catch (error) {
    res.status(400).json({
      status: "fail",
      message: error.message,
    });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "User not found",
      });
    }
    res.status(204).json({
      status: "success",
      data: null,
    });
  } catch (error) {
    res.status(400).json({
      status: "fail",
      message: error.message,
    });
  }
};

/*
=====================================================
GET MY PROFILE
GET /api/v1/users/me
=====================================================
*/

/*
=====================================================
UPDATE MY PROFILE
PATCH /api/v1/users/me
=====================================================
*/

exports.updateMyProfile = async (req, res) => {
  try {
    const { name, phone, country } = req.body;

    const updates = {};

    if (name !== undefined) {
      const cleanName = String(name).trim();

      if (cleanName.length < 2) {
        return res.status(400).json({
          status: "fail",
          message: "Name must contain at least 2 characters.",
        });
      }

      updates.name = cleanName;
    }

    if (phone !== undefined) {
      const cleanPhone = String(phone).trim();

      if (cleanPhone.length < 7) {
        return res.status(400).json({
          status: "fail",
          message: "Please provide a valid phone number.",
        });
      }

      updates.phone = cleanPhone;
    }

    if (country !== undefined) {
      const cleanCountry = String(country).trim();

      if (!cleanCountry) {
        return res.status(400).json({
          status: "fail",
          message: "Country cannot be empty.",
        });
      }

      updates.country = cleanCountry;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        status: "fail",
        message: "No profile changes were provided.",
      });
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    }).select(
      "-password -passwordResetToken -passwordResetExpires -emailVerificationToken -emailVerificationExpires",
    );

    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "User account not found.",
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Profile updated successfully.",
      data: {
        user,
      },
    });
  } catch (error) {
    console.error("UPDATE MY PROFILE ERROR:", error);

    return res.status(400).json({
      status: "fail",
      message: error.message,
    });
  }
};

/*
=====================================================
CHANGE MY PASSWORD
PATCH /api/v1/users/me/password
=====================================================
*/

exports.changeMyPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        status: "fail",
        message:
          "Current password, new password and confirmation are required.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        status: "fail",
        message: "New passwords do not match.",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        status: "fail",
        message: "New password must be at least 8 characters.",
      });
    }

    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "User account not found.",
      });
    }

    const passwordCorrect = await user.correctPassword(
      currentPassword,
      user.password,
    );

    if (!passwordCorrect) {
      return res.status(401).json({
        status: "fail",
        message: "Current password is incorrect.",
      });
    }

    user.password = newPassword;

    /*
     * Your UserModel already has passwordChangedAt
     * handling, so saving the document allows the
     * model hook to update it.
     */

    await user.save();

    return res.status(200).json({
      status: "success",
      message: "Password changed successfully. Please sign in again.",
    });
  } catch (error) {
    console.error("CHANGE PASSWORD ERROR:", error);

    return res.status(400).json({
      status: "fail",
      message: error.message,
    });
  }
};

/*
=====================================================
GET MY PROFILE
GET /api/v1/users/me
=====================================================
*/

exports.getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "-password -passwordResetToken -passwordResetExpires -emailVerificationToken -emailVerificationExpires",
    );

    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "User account not found.",
      });
    }

    return res.status(200).json({
      status: "success",
      data: {
        user,
      },
    });
  } catch (error) {
    console.error("GET MY PROFILE ERROR:", error);

    return res.status(500).json({
      status: "error",
      message: "Unable to load your profile.",
    });
  }
};

// =====================================================
// USER DASHBOARD
// =====================================================

exports.getUserDashboard = async (req, res, next) => {
  try {
    const userId = req.user._id;

    /*
    =====================================================
    GET USER
    =====================================================
    */

    const user = await User.findById(userId).select(
      "name email phone country profileImage role status emailVerified kycStatus kycVerifiedAt twoFactorEnabled twoFactorEnabledAt createdAt lastLoginAt preferences",
    );

    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "User account not found",
      });
    }

    /*
    =====================================================
    GET WALLET
    =====================================================
    */

    const wallet = await Wallet.findOne({
      user: userId,
    }).lean();

    /*
    =====================================================
    DEPOSIT STATISTICS
    =====================================================
    */

    const [
      totalDeposits,
      pendingDeposits,
      processingDeposits,
      successfulDeposits,
      failedDeposits,
      cancelledDeposits,
      expiredDeposits,
    ] = await Promise.all([
      Deposit.countDocuments({
        user: userId,
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
        status: "successful",
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

    /*
    =====================================================
    DEPOSIT VOLUME BY CURRENCY
    =====================================================
    */

    const depositVolume = await Deposit.aggregate([
      {
        $match: {
          user: userId,
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

    const depositVolumeByCurrency = {
      USD: 0,
      NGN: 0,
      CAD: 0,
      EUR: 0,
    };

    depositVolume.forEach((item) => {
      if (item._id) {
        depositVolumeByCurrency[item._id] = Number(item.total.toString());
      }
    });

    /*
    =====================================================
    WITHDRAWAL STATISTICS
    =====================================================
    */

    const [
      totalWithdrawals,
      pendingWithdrawals,
      underReviewWithdrawals,
      approvedWithdrawals,
      processingWithdrawals,
      successfulWithdrawals,
      rejectedWithdrawals,
      failedWithdrawals,
      cancelledWithdrawals,
    ] = await Promise.all([
      Withdrawal.countDocuments({
        user: userId,
      }),

      Withdrawal.countDocuments({
        user: userId,
        status: "pending",
      }),

      Withdrawal.countDocuments({
        user: userId,
        status: "under_review",
      }),

      Withdrawal.countDocuments({
        user: userId,
        status: "approved",
      }),

      Withdrawal.countDocuments({
        user: userId,
        status: "processing",
      }),

      Withdrawal.countDocuments({
        user: userId,
        status: "successful",
      }),

      Withdrawal.countDocuments({
        user: userId,
        status: "rejected",
      }),

      Withdrawal.countDocuments({
        user: userId,
        status: "failed",
      }),

      Withdrawal.countDocuments({
        user: userId,
        status: "cancelled",
      }),
    ]);

    /*
    =====================================================
    RECENT DEPOSITS
    =====================================================
    */

    const recentDeposits = await Deposit.find({
      user: userId,
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("amount currency status provider reference createdAt")
      .lean();

    /*
    =====================================================
    RECENT WITHDRAWALS
    =====================================================
    */

    const recentWithdrawals = await Withdrawal.find({
      user: userId,
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("amount currency status provider reference createdAt")
      .lean();

    /*
    =====================================================
    RECENT ACTIVITY
    =====================================================
    */

    const recentActivity = [
      ...recentDeposits.map((deposit) => ({
        type: "deposit",
        id: deposit._id,
        reference: deposit.reference,
        amount: Number(deposit.amount.toString()),
        currency: deposit.currency,
        status: deposit.status,
        provider: deposit.provider,
        createdAt: deposit.createdAt,
      })),

      ...recentWithdrawals.map((withdrawal) => ({
        type: "withdrawal",
        id: withdrawal._id,
        reference: withdrawal.reference,
        amount: Number(withdrawal.amount.toString()),
        currency: withdrawal.currency,
        status: withdrawal.status,
        provider: withdrawal.provider,
        createdAt: withdrawal.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 8);

    /*
    =====================================================
    WALLET DATA
    =====================================================
    */

    const walletData = wallet
      ? {
          _id: wallet._id,
          currency: wallet.currency,
          availableBalance: Number(wallet.availableBalance.toString()),
          lockedBalance: Number(wallet.lockedBalance.toString()),
          totalBalance:
            Number(wallet.availableBalance.toString()) +
            Number(wallet.lockedBalance.toString()),
          status: wallet.status,
          lastTransactionAt: wallet.lastTransactionAt,
        }
      : {
          _id: null,
          currency: user.preferences?.currency || "USD",
          availableBalance: 0,
          lockedBalance: 0,
          totalBalance: 0,
          status: "not_created",
          lastTransactionAt: null,
        };

    /*
    =====================================================
    RESPONSE
    =====================================================
    */

    res.status(200).json({
      status: "success",

      message: "User dashboard retrieved successfully",

      data: {
        /*
        =================================================
        USER
        =================================================
        */

        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          country: user.country,
          profileImage: user.profileImage,
          role: user.role,
          status: user.status,
          emailVerified: user.emailVerified,
          kycStatus: user.kycStatus,
          kycVerifiedAt: user.kycVerifiedAt,
          twoFactorEnabled: user.twoFactorEnabled,
          twoFactorEnabledAt: user.twoFactorEnabledAt,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
        },

        /*
        =================================================
        WALLET
        =================================================
        */

        wallet: walletData,

        /*
        =================================================
        DEPOSITS
        =================================================
        */

        deposits: {
          total: totalDeposits,
          pending: pendingDeposits,
          processing: processingDeposits,
          successful: successfulDeposits,
          failed: failedDeposits,
          cancelled: cancelledDeposits,
          expired: expiredDeposits,

          volume: depositVolumeByCurrency,
        },

        /*
        =================================================
        WITHDRAWALS
        =================================================
        */

        withdrawals: {
          total: totalWithdrawals,
          pending: pendingWithdrawals,
          underReview: underReviewWithdrawals,
          approved: approvedWithdrawals,
          processing: processingWithdrawals,
          successful: successfulWithdrawals,
          rejected: rejectedWithdrawals,
          failed: failedWithdrawals,
          cancelled: cancelledWithdrawals,
        },

        /*
        =================================================
        TRADING

        We haven't connected the trading/prop-firm models
        yet, so these remain null.
        =================================================
        */

        trading: {
          balance: null,
          profitLoss: null,
          drawdown: null,
          activeChallenge: null,
        },

        /*
        =================================================
        RECENT ACTIVITY
        =================================================
        */

        recentActivity,
      },
    });
  } catch (error) {
    next(error);
  }
};
