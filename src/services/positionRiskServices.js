const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const TradingPosition = require("../models/TradingPositionModel");
const MarketInstrument = require("../models/MarketInstrumentModel");

class PositionRiskError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "PositionRiskError";
    this.statusCode = statusCode;
  }
}

const hasOwn = (object, key) =>
  Object.prototype.hasOwnProperty.call(object, key);

const parseOptionalPrice = (value, fieldName) => {
  if (value === null || value === "") {
    return null;
  }

  let price;

  try {
    price = new Decimal(String(value));
  } catch {
    throw new PositionRiskError(`${fieldName} is invalid.`);
  }

  if (!price.isFinite() || price.lte(0)) {
    throw new PositionRiskError(
      `${fieldName} must be a finite number greater than zero.`,
    );
  }

  return price;
};

const toDecimal128 = (value) =>
  mongoose.Types.Decimal128.fromString(value.toFixed(8));

exports.updatePositionRisk = async ({
  userId,
  positionId,
  stopLoss,
  takeProfit,
  body,
}) => {
  if (!mongoose.isValidObjectId(positionId)) {
    throw new PositionRiskError("Invalid position ID.");
  }

  const hasStopLoss = hasOwn(body, "stopLoss");
  const hasTakeProfit = hasOwn(body, "takeProfit");

  if (!hasStopLoss && !hasTakeProfit) {
    throw new PositionRiskError("Provide stopLoss, takeProfit, or both.");
  }

  const position = await TradingPosition.findOne({
    _id: positionId,
    user: userId,
    status: "open",
  });

  if (!position) {
    throw new PositionRiskError(
      "Open position not found, or you do not have permission to modify it.",
      404,
    );
  }

  const instrument = await MarketInstrument.findById(
    position.instrument,
  ).select("symbol currentPrice isActive");

  if (!instrument || !instrument.isActive) {
    throw new PositionRiskError("The trading instrument is unavailable.");
  }

  let currentPrice;

  try {
    currentPrice = new Decimal(String(instrument.currentPrice));
  } catch {
    throw new PositionRiskError(
      "The instrument's current price is invalid.",
      500,
    );
  }

  if (!currentPrice.isFinite() || currentPrice.lte(0)) {
    throw new PositionRiskError(
      "The instrument's current price is unavailable.",
      400,
    );
  }

  const sl = hasStopLoss
    ? parseOptionalPrice(stopLoss, "Stop-loss")
    : position.stopLoss === null
      ? null
      : new Decimal(String(position.stopLoss));

  const tp = hasTakeProfit
    ? parseOptionalPrice(takeProfit, "Take-profit")
    : position.takeProfit === null
      ? null
      : new Decimal(String(position.takeProfit));

  if (position.side === "buy") {
    if (sl && !sl.lt(currentPrice)) {
      throw new PositionRiskError(
        "A buy stop-loss must be below the current market price.",
      );
    }

    if (tp && !tp.gt(currentPrice)) {
      throw new PositionRiskError(
        "A buy take-profit must be above the current market price.",
      );
    }
  } else if (position.side === "sell") {
    if (sl && !sl.gt(currentPrice)) {
      throw new PositionRiskError(
        "A sell stop-loss must be above the current market price.",
      );
    }

    if (tp && !tp.lt(currentPrice)) {
      throw new PositionRiskError(
        "A sell take-profit must be below the current market price.",
      );
    }
  } else {
    throw new PositionRiskError("The position side is invalid.", 500);
  }

  const updates = {};

  if (hasStopLoss) {
    updates.stopLoss = sl ? toDecimal128(sl) : null;
  }

  if (hasTakeProfit) {
    updates.takeProfit = tp ? toDecimal128(tp) : null;
  }

  // Include status and owner in the update filter to prevent
  // modifying a position that was closed during this request.
  const updatedPosition = await TradingPosition.findOneAndUpdate(
    {
      _id: position._id,
      user: userId,
      status: "open",
    },
    { $set: updates },
    {
      new: true,
      runValidators: true,
    },
  ).populate("instrument", "symbol name");

  if (!updatedPosition) {
    throw new PositionRiskError(
      "The position is no longer open or cannot be modified.",
      409,
    );
  }

  return updatedPosition;
};

exports.PositionRiskError = PositionRiskError;
