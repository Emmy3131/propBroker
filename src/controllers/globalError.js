const AppError = require("../utils/appError");

// ==========================
// DEV ERROR
// ==========================
const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    status: err.status,
    message: err.message,
    error: err,
    stack: err.stack,
  });
};

// ==========================
// PROD ERROR
// ==========================
const sendErrorProd = (err, res) => {
   
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      errors: err
    });
  } else {
    console.error("ERROR", err);

    res.status(500).json({
      status: "error",
      message: "Something went wrong!",
    });
  }
};


// DB ERROR HANDLERS


// Invalid ID
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400);
};

// Duplicate fields
const handleDuplicateFieldsDB = (err) => {
  const value = Object.values(err.keyValue)[0];
  const message = `Duplicate field value: ${value}. Please use another value`;
  return new AppError(message, 400);
};

// Validation error
const handleValidationErrorDB = (err) => {
    console.log(err)
//   const errors = Object.values(err.errors).map((el) => el.message);
//   const message = `Invalid input data. ${errors.join(". ")}`;
const errors = Object.values(err.errors).reduce((acc, el) => {
    acc[el.path] = el.message;
    return acc;
}, {});

  return new AppError('Invalid input data.', 400, errors);
};

const handleJWTError = ()=> new AppError("Invalid token. Please log in again", 401, '')
const handleExpireJWT = ()=> new AppError("Token expired! Please log in again.", 401, '')


// GLOBAL ERROR HANDLER

module.exports = (err, req, res, next) => {
   // console.log('LIVE ERROR!!',err)
  // Default values
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  // DEVELOPMENT
  if (process.env.NODE_ENV === "development") {
    sendErrorDev(err, res);
  }

  // PRODUCTION
  else if (process.env.NODE_ENV === "production") {
    let error = err ;
    // error.message = err.message;

    // // Handle specific errors
    if (err.name === "CastError") error = handleCastErrorDB(err);

    if (err.code === 11000) error = handleDuplicateFieldsDB(err);
    if(err.name === 'JsonWebTokenError')error =  handleJWTError()
    if(err.name === 'TokenExpiredError') error = handleExpireJWT()

    if (err.name === "ValidationError")
      error = handleValidationErrorDB(err);

    sendErrorProd(error, res);
  }
};