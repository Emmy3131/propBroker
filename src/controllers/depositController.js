const Deposit = require("../models/DepositModel");
const Wallet = require("../models/WalletModel");

const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");
const { generateDepositReference } = require("../utils/depositReference");
const {
  initializeTransaction,
} = require("../services/providers/paystackService");

/*
=====================================================
ALLOWED CURRENCIES
=====================================================
*/

const SUPPORTED_CURRENCIES = ["NGN", "USD"];

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


/**
 * Create and initialize a Paystack deposit.
 */
exports.createDeposit = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  const { amount, currency = "NGN", provider = "paystack" } = req.body;

  const normalizedCurrency = String(currency).toUpperCase();
  const normalizedProvider = String(provider).toLowerCase();

  /**
   * --------------------------------------------
   * 1. Validate provider
   * --------------------------------------------
   */
  if (normalizedProvider !== "paystack") {
    return next(
      new AppError("Only Paystack deposits are currently supported.", 400),
    );
  }

  /**
   * --------------------------------------------
   * 2. Validate currency
   * --------------------------------------------
   */
  if (!SUPPORTED_CURRENCIES.includes(normalizedCurrency)) {
    return next(
      new AppError("Paystack deposits currently support NGN and USD.", 400),
    );
  }

  /**
   * --------------------------------------------
   * 3. Validate amount
   * --------------------------------------------
   */
  if (amount === undefined || amount === null || amount === "") {
    return next(new AppError("Deposit amount is required.", 400));
  }

  const amountString = String(amount).trim();

  if (!/^\d+(\.\d{1,2})?$/.test(amountString)) {
    return next(
      new AppError(
        "Invalid amount. Use a positive amount with at most 2 decimal places.",
        400,
      ),
    );
  }

  const amountNumber = Number(amountString);

  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return next(new AppError("Deposit amount must be greater than zero.", 400));
  }

  /**
   * --------------------------------------------
   * 4. Find user's wallet
   * --------------------------------------------
   */
  const wallet = await Wallet.findOne({
    user: userId,
  });

  if (!wallet) {
    return next(
      new AppError("Wallet not found. Please create your wallet first.", 404),
    );
  }

  /**
   * --------------------------------------------
   * 5. Check wallet status
   * --------------------------------------------
   */
  if (wallet.status !== "active") {
    return next(
      new AppError(
        `Your wallet is currently ${wallet.status}. Deposits are not allowed.`,
        403,
      ),
    );
  }

  /**
   * --------------------------------------------
   * 6. Make sure wallet currency matches
   * --------------------------------------------
   */
  if (wallet.currency !== normalizedCurrency) {
    return next(
      new AppError(
        `Your wallet currency is ${wallet.currency}. You cannot make a ${normalizedCurrency} deposit into this wallet.`,
        400,
      ),
    );
  }

  /**
   * --------------------------------------------
   * 7. Generate internal reference
   * --------------------------------------------
   */
  const reference = generateDepositReference();

  /**
   * --------------------------------------------
   * 8. Create pending deposit
   * --------------------------------------------
   */
  const deposit = await Deposit.create({
    user: userId,
    wallet: wallet._id,
    provider: normalizedProvider,
    reference,
    amount: mongoose.Types.Decimal128.fromString(amountString),
    currency: normalizedCurrency,
    status: "pending",
  });

  try {
    /**
     * --------------------------------------------
     * 9. Initialize payment with Paystack
     * --------------------------------------------
     */
    const paystackResponse = await initializeTransaction({
      email: req.user.email,
      amount: amountString,
      currency: normalizedCurrency,
      reference,
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL,
      metadata: {
        depositId: deposit._id.toString(),
        userId: userId.toString(),
        walletId: wallet._id.toString(),
        reference,
      },
    });

    /**
     * --------------------------------------------
     * 10. Update deposit
     * --------------------------------------------
     */
    deposit.status = "processing";
    deposit.paymentUrl = paystackResponse.data.authorization_url;

    deposit.providerReference = paystackResponse.data.reference || reference;

    await deposit.save();

    /**
     * --------------------------------------------
     * 11. Return checkout information
     * --------------------------------------------
     */
    return res.status(201).json({
      status: "success",
      message: "Deposit initialized successfully.",
      data: {
        depositId: deposit._id,
        reference: deposit.reference,
        amount: deposit.amount.toString(),
        currency: deposit.currency,
        status: deposit.status,
        paymentUrl: deposit.paymentUrl,
      },
    });
  } catch (error) {
    /**
     * Paystack initialization failed.
     *
     * The deposit remains in our database so that
     * we have an audit trail.
     */
    deposit.status = "failed";
    deposit.failureReason = error.message || "Payment initialization failed.";

    await deposit.save();

    throw error;
  }
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

  /*
    -------------------------------------------------
    OPTIONAL STATUS FILTER
    -------------------------------------------------
    */

  if (req.query.status) {
    const allowedStatuses = [
      "pending",
      "processing",
      "successful",
      "failed",
      "cancelled",
      "expired",
    ];

    const status = String(req.query.status).toLowerCase();

    if (!allowedStatuses.includes(status)) {
      return next(new AppError("Invalid deposit status.", 400));
    }

    filter.status = status;
  }

  /*
    -------------------------------------------------
    QUERY
    -------------------------------------------------
    */

  const [deposits, total] = await Promise.all([
    Deposit.find(filter)
      .select("-providerData")
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit),

    Deposit.countDocuments(filter),
  ]);

  /*
    -------------------------------------------------
    RESPONSE
    -------------------------------------------------
    */

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
GET SINGLE DEPOSIT
=====================================================
*/

exports.getMyDeposit = catchAsync(async (req, res, next) => {
  const deposit = await Deposit.findOne({
    _id: req.params.id,
    user: req.user._id,
  }).select("-providerData");

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

exports.getMyDepositByReference = catchAsync(async (req, res, next) => {
  const { reference } = req.params;

  if (!reference) {
    return next(new AppError("Deposit reference is required.", 400));
  }

  const deposit = await Deposit.findOne({
    reference,
    user: req.user._id,
  }).select("-providerData");

  if (!deposit) {
    return next(new AppError("Deposit not found.", 404));
  }

  return res.status(200).json({
    status: "success",
    data: {
      deposit,
    },
  });
});
