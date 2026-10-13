const mongoose = require("mongoose");
const tradeHistoryService = require("../services/tradeHistoryServices");

exports.getTradeHistory = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const {
      accountId,
      side,
      result,
      from,
      to,
      page = "1",
      limit = "20",
    } = req.query;

    if (accountId && !mongoose.isValidObjectId(accountId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid trading account ID.",
      });
    }

    if (side && !["buy", "sell"].includes(side)) {
      return res.status(400).json({
        status: "error",
        message: "Side must be buy or sell.",
      });
    }

    if (result && !["win", "loss", "breakeven"].includes(result)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid trade result filter.",
      });
    }

    const parsedPage = Number(page);
    const parsedLimit = Number(limit);

    if (
      !Number.isInteger(parsedPage) ||
      parsedPage < 1 ||
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > 100
    ) {
      return res.status(400).json({
        status: "error",
        message: "Page must be positive and limit must be between 1 and 100.",
      });
    }

    const validDate = (value) =>
      !value ||
      (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) &&
        !Number.isNaN(Date.parse(value)));

    if (!validDate(from) || !validDate(to)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid date filter. Use an ISO date or datetime.",
      });
    }

    if (from && to && new Date(from) > new Date(to)) {
      return res.status(400).json({
        status: "error",
        message: "The from date must not be after the to date.",
      });
    }

    const data = await tradeHistoryService.getTradeHistory({
      userId,
      accountId,
      side,
      result,
      from,
      to,
      page: parsedPage,
      limit: parsedLimit,
    });

    return res.status(200).json({
      status: "success",
      results: data.trades.length,
      data,
    });
  } catch (error) {
    console.error("Trade history error:", error);

    const clientErrorMessages = [
      "Invalid trading account ID.",
      "Trading account not found.",
    ];

    const isClientError = clientErrorMessages.includes(error.message);

    return res.status(isClientError ? 400 : 500).json({
      status: "error",
      message: isClientError ? error.message : "Unable to load trade history.",
    });
  }
};

exports.getAccountPerformance = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { accountId } = req.params;

    if (!mongoose.isValidObjectId(accountId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid trading account ID.",
      });
    }

    const data = await tradeHistoryService.getAccountPerformance({
      userId,
      accountId,
    });

    return res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.error("Account performance error:", error);

    const isNotFound = error.message === "Trading account not found.";

    return res.status(isNotFound ? 404 : 500).json({
      status: "error",
      message: isNotFound
        ? error.message
        : "Unable to load account performance.",
    });
  }
};
