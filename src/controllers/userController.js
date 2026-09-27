const mongoose = require("mongoose");

const User = require("../models/UserModel");

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
      "-password -passwordResetToken -passwordResetExpires -emailVerificationToken -emailVerificationExpires"
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
