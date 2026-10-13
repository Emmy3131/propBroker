const mongoose = require("mongoose");

const TradingOrder = require("../models/TradingOrderModel");
const TradingPosition = require("../models/TradingPositionModel");
const tradingExecutionService = require("../services/tradingExecutionService");
const positionManagementService = require("../services/positionManagementServices");

const getUserId = (req) => req.user?._id || req.user?.id;

exports.placeMarketOrder = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication is required.",
      });
    }

    const { accountId, symbol, side, quantity, stopLoss, takeProfit } =
      req.body;

    if (!accountId || !symbol || !side || quantity === undefined) {
      return res.status(400).json({
        status: "error",
        message: "accountId, symbol, side, and quantity are required.",
      });
    }

    const result = await tradingExecutionService.openMarketOrder({
      userId,
      accountId,
      symbol,
      side,
      quantity,
      stopLoss,
      takeProfit,
    });

    return res.status(201).json({
      status: "success",
      message: "Simulated market order filled successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

exports.getMyOrders = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication is required.",
      });
    }

    const filter = { user: userId };

    if (req.query.accountId) {
      if (!mongoose.isValidObjectId(req.query.accountId)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid trading account ID.",
        });
      }

      filter.tradingAccount = req.query.accountId;
    }

    const orders = await TradingOrder.find(filter)
      .populate("instrument", "symbol name")
      .populate("position")
      .sort({ createdAt: -1 })
      .limit(100);

    return res.status(200).json({
      status: "success",
      results: orders.length,
      data: { orders },
    });
  } catch (error) {
    next(error);
  }
};

exports.getMyPositions = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication is required.",
      });
    }

    const filter = { user: userId };

    if (req.query.accountId) {
      if (!mongoose.isValidObjectId(req.query.accountId)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid trading account ID.",
        });
      }

      filter.tradingAccount = req.query.accountId;
    }

    if (req.query.status) {
      if (!["open", "closed"].includes(req.query.status)) {
        return res.status(400).json({
          status: "error",
          message: "Status must be open or closed.",
        });
      }

      filter.status = req.query.status;
    }

    const positions = await TradingPosition.find(filter)
      .populate("instrument", "symbol name")
      .sort({ createdAt: -1 })
      .limit(100);

    return res.status(200).json({
      status: "success",
      results: positions.length,
      data: { positions },
    });
  } catch (error) {
    next(error);
  }
};

exports.closePosition = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    const result = await positionManagementService.closePosition({
      userId,
      positionId: req.params.id,
    });

    return res.status(200).json({
      status: "success",
      message: "Position closed successfully.",
      data: {
        position: result.position,
        account: result.account,
        realizedPnl: result.realizedPnl,
      },
    });
  } catch (error) {
    const clientErrors = [
      "Invalid position ID.",
      "Open position not found, or you do not have permission to close it.",
      "Trading account not found.",
      "The instrument's closing price is unavailable.",
      "This simulator can only close USD-quoted simulated instruments.",
      "Position pricing or quantity is invalid.",
      "Position margin exceeds account used margin. Review the account before closing.",
    ];

    const isClientError = clientErrors.includes(error.message);

    console.error("Close position error:", error);

    return res.status(isClientError ? 400 : 500).json({
      status: "error",
      message: isClientError
        ? error.message
        : "Unable to close the position. Please try again.",
    });
  }
};
