const jwt = require("jsonwebtoken");

const User = require("../models/UserModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");

// =========================================================
// PROTECT ROUTE
// =========================================================

exports.protect = catchAsync(async (req, res, next) => {
  let token;

  // -------------------------------------------------------
  // GET TOKEN FROM AUTHORIZATION HEADER
  // -------------------------------------------------------

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return next(
      new AppError(
        "You are not logged in. Please log in to access this resource.",
        401
      )
    );
  }

  // -------------------------------------------------------
  // VERIFY JWT
  // -------------------------------------------------------

  let decoded;

  try {
    decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );
  } catch (error) {
    return next(
      new AppError(
        "Invalid or expired authentication token",
        401
      )
    );
  }

  // -------------------------------------------------------
  // FIND USER
  // -------------------------------------------------------

  const user = await User.findById(decoded.id);

  if (!user) {
    return next(
      new AppError(
        "The user belonging to this token no longer exists",
        401
      )
    );
  }

  // -------------------------------------------------------
  // CHECK PASSWORD CHANGE
  // -------------------------------------------------------

  if (user.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError(
        "Your password was recently changed. Please log in again.",
        401
      )
    );
  }

  // -------------------------------------------------------
  // CHECK ACCOUNT STATUS
  // -------------------------------------------------------

  if (user.status === "blocked") {
    return next(
      new AppError(
        "Your account has been blocked",
        403
      )
    );
  }

  if (user.status === "suspended") {
    return next(
      new AppError(
        "Your account has been suspended",
        403
      )
    );
  }

  if (user.status === "closed") {
    return next(
      new AppError(
        "This account has been closed",
        403
      )
    );
  }

  // -------------------------------------------------------
  // ATTACH USER TO REQUEST
  // -------------------------------------------------------

  req.user = user;

  next();
});


// =========================================================
// RESTRICT TO ROLES
// =========================================================

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(
          "You do not have permission to perform this action",
          403
        )
      );
    }

    next();
  };
};