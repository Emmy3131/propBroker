const AppError = require("../utils/appError");

const sendErrorDev = (err, res) => {
  res.status(err.statusCode || 500).json({
    status: err.status || "error",
    message: err.message,
    error: err,
    stack: err.stack,
  });
};

const sendErrorProd = (err, res) => {
  /*
    ============================================
    OPERATIONAL ERROR
    ============================================
    */

  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  }

  /*
    ============================================
    PROGRAMMING / UNKNOWN ERROR
    ============================================
    */

  console.error("UNEXPECTED ERROR:", err);

  return res.status(500).json({
    status: "error",
    message: "Something went wrong. Please try again later.",
  });
};

const errorHandler = (err, req, res, next) => {
  /*
    Make sure every error has a status code.
    */

  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  /*
    Development
    */

  if (process.env.NODE_ENV === "development") {
    return sendErrorDev(err, res);
  }

  /*
    Production
    */

  let error = { ...err };
  error.message = err.message;

  /*
    ============================================
    MONGOOSE CAST ERROR
    ============================================
    */

  if (err.name === "CastError") {
    error = new AppError(`Invalid ${err.path}: ${err.value}`, 400);
  }

  /*
    ============================================
    MONGOOSE DUPLICATE KEY ERROR
    ============================================
    */

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0];

    error = new AppError(
      `An account with this ${field || "value"} already exists.`,
      409,
    );
  }

  /*
    ============================================
    MONGOOSE VALIDATION ERROR
    ============================================
    */

  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors)
      .map((el) => el.message)
      .join(". ");

    error = new AppError(messages || "Validation failed.", 400);
  }

  /*
    ============================================
    JWT INVALID TOKEN
    ============================================
    */

  if (err.name === "JsonWebTokenError") {
    error = new AppError("Invalid authentication token.", 401);
  }

  /*
    ============================================
    JWT EXPIRED TOKEN
    ============================================
    */

  if (err.name === "TokenExpiredError") {
    error = new AppError("Your authentication token has expired.", 401);
  }

  return sendErrorProd(error, res);
};

module.exports = errorHandler;
