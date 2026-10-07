const PaymentMethod = require("../models/PaymentModel");

const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");

/*
=====================================================
SUPPORTED CURRENCIES
=====================================================
*/

const SUPPORTED_CURRENCIES = ["USD", "NGN", "CAD", "EUR"];

/*
=====================================================
SUPPORTED PAYMENT TYPES
=====================================================
*/

const SUPPORTED_TYPES = ["bank_transfer", "crypto", "mobile_money", "other"];

/*
=====================================================
NORMALIZE CURRENCY
=====================================================
*/

const normalizeCurrency = (currency) => {
  return String(currency || "")
    .trim()
    .toUpperCase();
};

/*
=====================================================
NORMALIZE TYPE
=====================================================
*/

const normalizeType = (type) => {
  return String(type || "")
    .trim()
    .toLowerCase();
};

/*
=====================================================
CREATE PAYMENT METHOD
=====================================================
*/

exports.createPaymentMethod = catchAsync(async (req, res, next) => {
  const {
    name,
    type,
    currency,
    bankName,
    accountName,
    accountNumber,
    routingNumber,
    iban,
    swiftCode,
    network,
    walletAddress,
    instructions,
    displayOrder,
    status,
  } = req.body;

  const normalizedCurrency = normalizeCurrency(currency);

  const normalizedType = normalizeType(type);

  /*
    -----------------------------------------------
    VALIDATE NAME
    -----------------------------------------------
    */

  if (!name || !String(name).trim()) {
    return next(new AppError("Payment method name is required.", 400));
  }

  /*
    -----------------------------------------------
    VALIDATE CURRENCY
    -----------------------------------------------
    */

  if (!SUPPORTED_CURRENCIES.includes(normalizedCurrency)) {
    return next(
      new AppError(
        `Unsupported currency. Supported currencies are: ${SUPPORTED_CURRENCIES.join(
          ", ",
        )}.`,
        400,
      ),
    );
  }

  /*
    -----------------------------------------------
    VALIDATE PAYMENT TYPE
    -----------------------------------------------
    */

  if (!SUPPORTED_TYPES.includes(normalizedType)) {
    return next(
      new AppError(
        `Unsupported payment method type. Supported types are: ${SUPPORTED_TYPES.join(
          ", ",
        )}.`,
        400,
      ),
    );
  }

  /*
    -----------------------------------------------
    BANK TRANSFER VALIDATION
    -----------------------------------------------
    */

  if (normalizedType === "bank_transfer") {
    if (!bankName || !String(bankName).trim()) {
      return next(
        new AppError("Bank name is required for bank transfer.", 400),
      );
    }

    if (!accountName || !String(accountName).trim()) {
      return next(
        new AppError("Account name is required for bank transfer.", 400),
      );
    }

    if (!accountNumber || !String(accountNumber).trim()) {
      return next(
        new AppError("Account number is required for bank transfer.", 400),
      );
    }
  }

  /*
    -----------------------------------------------
    CRYPTO VALIDATION
    -----------------------------------------------
    */

  if (normalizedType === "crypto") {
    if (!network || !String(network).trim()) {
      return next(new AppError("Network is required for crypto payment.", 400));
    }

    if (!walletAddress || !String(walletAddress).trim()) {
      return next(
        new AppError("Wallet address is required for crypto payment.", 400),
      );
    }
  }

  /*
    -----------------------------------------------
    DISPLAY ORDER
    -----------------------------------------------
    */

  let normalizedDisplayOrder = 0;

  if (
    displayOrder !== undefined &&
    displayOrder !== null &&
    displayOrder !== ""
  ) {
    normalizedDisplayOrder = Number(displayOrder);

    if (!Number.isFinite(normalizedDisplayOrder)) {
      return next(new AppError("Display order must be a valid number.", 400));
    }
  }

  /*
    -----------------------------------------------
    STATUS
    -----------------------------------------------
    */

  const normalizedStatus = status === "inactive" ? "inactive" : "active";

  /*
    -----------------------------------------------
    CREATE
    -----------------------------------------------
    */

  const paymentMethod = await PaymentMethod.create({
    name: String(name).trim(),

    type: normalizedType,

    currency: normalizedCurrency,

    bankName: bankName ? String(bankName).trim() : null,

    accountName: accountName ? String(accountName).trim() : null,

    accountNumber: accountNumber ? String(accountNumber).trim() : null,

    routingNumber: routingNumber ? String(routingNumber).trim() : null,

    iban: iban ? String(iban).trim() : null,

    swiftCode: swiftCode ? String(swiftCode).trim() : null,

    network: network ? String(network).trim() : null,

    walletAddress: walletAddress ? String(walletAddress).trim() : null,

    instructions: instructions ? String(instructions).trim() : "",

    displayOrder: normalizedDisplayOrder,

    status: normalizedStatus,

    createdBy: req.user._id,
  });

  res.status(201).json({
    status: "success",
    message: "Payment method created successfully.",
    data: {
      paymentMethod,
    },
  });
});

/*
=====================================================
GET ALL PAYMENT METHODS — ADMIN
=====================================================
*/

exports.getAllPaymentMethods = catchAsync(async (req, res) => {
  const { status, currency, type, search } = req.query;

  const filter = {};

  /*
    -----------------------------------------------
    STATUS
    -----------------------------------------------
    */

  if (status && ["active", "inactive"].includes(String(status).toLowerCase())) {
    filter.status = String(status).toLowerCase();
  }

  /*
    -----------------------------------------------
    CURRENCY
    -----------------------------------------------
    */

  if (currency) {
    const normalizedCurrency = normalizeCurrency(currency);

    if (SUPPORTED_CURRENCIES.includes(normalizedCurrency)) {
      filter.currency = normalizedCurrency;
    }
  }

  /*
    -----------------------------------------------
    TYPE
    -----------------------------------------------
    */

  if (type) {
    const normalizedType = normalizeType(type);

    if (SUPPORTED_TYPES.includes(normalizedType)) {
      filter.type = normalizedType;
    }
  }

  /*
    -----------------------------------------------
    SEARCH
    -----------------------------------------------
    */

  if (search && String(search).trim()) {
    filter.name = {
      $regex: String(search).trim(),
      $options: "i",
    };
  }

  const paymentMethods = await PaymentMethod.find(filter)
    .populate("createdBy", "name email role")
    .populate("updatedBy", "name email role")
    .sort({
      currency: 1,
      displayOrder: 1,
      createdAt: -1,
    });

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
GET ONE PAYMENT METHOD — ADMIN
=====================================================
*/

exports.getPaymentMethod = catchAsync(async (req, res, next) => {
  const paymentMethod = await PaymentMethod.findById(req.params.id)
    .populate("createdBy", "name email role")
    .populate("updatedBy", "name email role");

  if (!paymentMethod) {
    return next(new AppError("Payment method not found.", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      paymentMethod,
    },
  });
});

/*
=====================================================
UPDATE PAYMENT METHOD
=====================================================
*/

exports.updatePaymentMethod = catchAsync(async (req, res, next) => {
  const paymentMethod = await PaymentMethod.findById(req.params.id);

  if (!paymentMethod) {
    return next(new AppError("Payment method not found.", 404));
  }

  const {
    name,
    type,
    currency,
    bankName,
    accountName,
    accountNumber,
    routingNumber,
    iban,
    swiftCode,
    network,
    walletAddress,
    instructions,
    displayOrder,
    status,
  } = req.body;

  /*
    -----------------------------------------------
    UPDATE BASIC FIELDS
    -----------------------------------------------
    */

  if (name !== undefined) {
    if (!String(name).trim()) {
      return next(new AppError("Payment method name cannot be empty.", 400));
    }

    paymentMethod.name = String(name).trim();
  }

  /*
    -----------------------------------------------
    UPDATE TYPE
    -----------------------------------------------
    */

  if (type !== undefined) {
    const normalizedType = normalizeType(type);

    if (!SUPPORTED_TYPES.includes(normalizedType)) {
      return next(new AppError("Invalid payment method type.", 400));
    }

    paymentMethod.type = normalizedType;
  }

  /*
    -----------------------------------------------
    UPDATE CURRENCY
    -----------------------------------------------
    */

  if (currency !== undefined) {
    const normalizedCurrency = normalizeCurrency(currency);

    if (!SUPPORTED_CURRENCIES.includes(normalizedCurrency)) {
      return next(new AppError("Invalid payment currency.", 400));
    }

    paymentMethod.currency = normalizedCurrency;
  }

  /*
    -----------------------------------------------
    OPTIONAL FIELDS
    -----------------------------------------------
    */

  const stringFields = [
    "bankName",
    "accountName",
    "accountNumber",
    "routingNumber",
    "iban",
    "swiftCode",
    "network",
    "walletAddress",
    "instructions",
  ];

  for (const field of stringFields) {
    if (req.body[field] !== undefined) {
      paymentMethod[field] =
        req.body[field] === null ? null : String(req.body[field]).trim();
    }
  }

  /*
    -----------------------------------------------
    DISPLAY ORDER
    -----------------------------------------------
    */

  if (displayOrder !== undefined) {
    const parsedOrder = Number(displayOrder);

    if (!Number.isFinite(parsedOrder)) {
      return next(new AppError("Display order must be a valid number.", 400));
    }

    paymentMethod.displayOrder = parsedOrder;
  }

  /*
    -----------------------------------------------
    STATUS
    -----------------------------------------------
    */

  if (status !== undefined) {
    if (!["active", "inactive"].includes(String(status).toLowerCase())) {
      return next(new AppError("Invalid payment method status.", 400));
    }

    paymentMethod.status = String(status).toLowerCase();
  }

  paymentMethod.updatedBy = req.user._id;

  await paymentMethod.save();

  res.status(200).json({
    status: "success",
    message: "Payment method updated successfully.",
    data: {
      paymentMethod,
    },
  });
});

/*
=====================================================
DELETE PAYMENT METHOD
=====================================================
*/

exports.deletePaymentMethod = catchAsync(async (req, res, next) => {
  const paymentMethod = await PaymentMethod.findById(req.params.id);

  if (!paymentMethod) {
    return next(new AppError("Payment method not found.", 404));
  }

  /*
    -----------------------------------------------
    SOFT DELETE
    -----------------------------------------------

    We don't physically delete the record.
    Existing deposits may reference it.
    */

  paymentMethod.status = "inactive";

  paymentMethod.updatedBy = req.user._id;

  await paymentMethod.save();

  res.status(200).json({
    status: "success",
    message: "Payment method deactivated successfully.",
    data: {
      paymentMethod,
    },
  });
});

/*
=====================================================
GET ACTIVE PAYMENT METHODS — USER
=====================================================
*/

exports.getActivePaymentMethods = catchAsync(async (req, res) => {
  const { currency, type } = req.query;

  const filter = {
    status: "active",
  };

  if (currency) {
    const normalizedCurrency = normalizeCurrency(currency);

    if (!SUPPORTED_CURRENCIES.includes(normalizedCurrency)) {
      return res.status(200).json({
        status: "success",
        results: 0,
        data: {
          paymentMethods: [],
        },
      });
    }

    filter.currency = normalizedCurrency;
  }

  if (type) {
    const normalizedType = normalizeType(type);

    if (!SUPPORTED_TYPES.includes(normalizedType)) {
      return res.status(200).json({
        status: "success",
        results: 0,
        data: {
          paymentMethods: [],
        },
      });
    }

    filter.type = normalizedType;
  }

  const paymentMethods = await PaymentMethod.find(filter)
    .select(
      [
        "name",
        "type",
        "currency",
        "bankName",
        "accountName",
        "accountNumber",
        "routingNumber",
        "iban",
        "swiftCode",
        "network", 
        "walletAddress",
        "instructions",
        "displayOrder",
      ].join(" "),
    )
    .sort({
      displayOrder: 1,
      createdAt: -1,
    });

  res.status(200).json({
    status: "success",
    results: paymentMethods.length,
    data: {
      paymentMethods,
    },
  });
});
