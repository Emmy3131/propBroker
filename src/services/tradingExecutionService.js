const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const TradingAccount = require("../models/TradingAccountModel");
const MarketInstrument = require("../models/MarketInstrumentModel");
const TradingOrder = require("../models/TradingOrderModel");
const TradingPosition = require("../models/TradingPositionModel");
const tradingRiskService = require("./tradingRiskService");

class TradingError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const money = (value) => new Decimal(value.toString());

const decimal128 = (value) =>
  mongoose.Types.Decimal128.fromString(new Decimal(value).toFixed(8));

exports.openMarketOrder = async ({
  userId,
  accountId,
  symbol,
  side,
  quantity,
  stopLoss,
  takeProfit,
}) => {
  if (!mongoose.isValidObjectId(accountId)) {
    throw new TradingError("Invalid trading account ID.");
  }

  const normalizedSymbol = String(symbol || "")
    .trim()
    .toUpperCase();
  const normalizedSide = String(side || "")
    .trim()
    .toLowerCase();

  if (!normalizedSymbol) {
    throw new TradingError("A trading symbol is required.");
  }

  if (!["buy", "sell"].includes(normalizedSide)) {
    throw new TradingError("Side must be buy or sell.");
  }

  let qty;

  try {
    qty = new Decimal(String(quantity));
  } catch {
    throw new TradingError("Invalid trade quantity.");
  }

  if (!qty.isFinite() || qty.lt("0.01") || qty.gt("100")) {
    throw new TradingError("Quantity must be between 0.01 and 100 lots.");
  }

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const account = await TradingAccount.findOne({
        _id: accountId,
        user: userId,
      }).session(session);

      if (!account) {
        throw new TradingError("Trading account not found.", 404);
      }

      if (account.status !== "active") {
        throw new TradingError("This trading account is not active.");
      }

      const instrument = await MarketInstrument.findOne({
        symbol: normalizedSymbol,
        isActive: true,
      }).session(session);

      if (!instrument) {
        throw new TradingError("Instrument not found or inactive.", 404);
      }

      if (instrument.priceSource !== "simulated") {
        throw new TradingError(
          "This execution service only accepts simulated prices.",
        );
      }

      if (instrument.quoteCurrency !== "USD") {
        throw new TradingError(
          "This instrument is not yet supported by the USD P&L engine.",
        );
      }

      if (!instrument.contractSize) {
        throw new TradingError(
          "Instrument contract size has not been configured.",
          500,
        );
      }

      const price = money(instrument.currentPrice);
      const contractSize = money(instrument.contractSize);
      const leverage = new Decimal(String(account.leverage));

      if (
        !price.isFinite() ||
        price.lte(0) ||
        !contractSize.isFinite() ||
        contractSize.lte(0) ||
        !leverage.isFinite() ||
        leverage.lte(0)
      ) {
        throw new TradingError(
          "Instrument or account trading configuration is invalid.",
          500,
        );
      }

      const parseOptionalPrice = (value, fieldName) => {
        if (value === undefined || value === null || value === "") {
          return null;
        }

        let parsed;

        try {
          parsed = new Decimal(String(value));
        } catch {
          throw new TradingError(`${fieldName} is invalid.`);
        }

        if (!parsed.isFinite() || parsed.lte(0)) {
          throw new TradingError(`${fieldName} must be greater than zero.`);
        }

        return parsed;
      };

      const sl = parseOptionalPrice(stopLoss, "Stop-loss");
      const tp = parseOptionalPrice(takeProfit, "Take-profit");

      if (normalizedSide === "buy") {
        if (sl && !sl.lt(price)) {
          throw new TradingError(
            "A buy stop-loss must be below the entry price.",
          );
        }

        if (tp && !tp.gt(price)) {
          throw new TradingError(
            "A buy take-profit must be above the entry price.",
          );
        }
      } else {
        if (sl && !sl.gt(price)) {
          throw new TradingError(
            "A sell stop-loss must be above the entry price.",
          );
        }

        if (tp && !tp.lt(price)) {
          throw new TradingError(
            "A sell take-profit must be below the entry price.",
          );
        }
      }

      const riskResult = await tradingRiskService.evaluateAccountRisk(
        account,
        session,
      );

      if (!riskResult.allowedToTrade) {
        throw new Error(
          `Trading is not allowed. Account status: ${account.status}.`,
        );
      }

      const notional = price.mul(qty).mul(contractSize);
      const requiredMargin = notional.div(leverage);

      const balance = money(account.balance);
      const usedMargin = money(account.usedMargin || "0");
      const equity = money(account.equity);

      const freeMargin = equity.minus(usedMargin);

      if (balance.lte(0) || equity.lte(0)) {
        throw new TradingError("Insufficient account equity to open a trade.");
      }

      if (requiredMargin.gt(freeMargin)) {
        throw new TradingError("Insufficient free margin for this trade.");
      }

      const nextUsedMargin = usedMargin.plus(requiredMargin);
      const nextFreeMargin = equity.minus(nextUsedMargin);

      // Record the order first so the position can reference it.
      const [order] = await TradingOrder.create(
        [
          {
            user: userId,
            tradingAccount: account._id,
            instrument: instrument._id,
            symbol: instrument.symbol,
            side: normalizedSide,
            orderType: "market",
            quantity: decimal128(qty),
            requestedPrice: decimal128(price),
            executionPrice: decimal128(price),
            status: "filled",
            position: null,
          },
        ],
        { session },
      );

      const [position] = await TradingPosition.create(
        [
          {
            user: userId,
            tradingAccount: account._id,
            instrument: instrument._id,
            order: order._id,
            symbol: instrument.symbol,
            side: normalizedSide,
            quantity: decimal128(qty),
            contractSize: decimal128(contractSize),
            entryPrice: decimal128(price),
            currentPrice: decimal128(price),
            notionalValue: decimal128(notional),
            marginUsed: decimal128(requiredMargin),
            unrealizedPnl: decimal128("0"),
            stopLoss: sl ? decimal128(sl) : null,
            takeProfit: tp ? decimal128(tp) : null,
            status: "open",
          },
        ],
        { session },
      );

      order.position = position._id;
      await order.save({ session });

      account.usedMargin = decimal128(nextUsedMargin);
      account.freeMargin = decimal128(nextFreeMargin);
      await account.save({ session });

      result = { order, position };
    });

    return result;
  } finally {
    await session.endSession();
  }
};

exports.TradingError = TradingError;
