
const MarketInstrument = require("../models/MarketInstrumentModel");

// These are simulated example prices, not live market quotes.
const DEFAULT_INSTRUMENTS = [
  {
    symbol: "EURUSD",
    name: "Euro / US Dollar",
    assetClass: "forex",
    baseCurrency: "EUR",
    quoteCurrency: "USD",
    contractSize: "100000",
    currentPrice: "1.10000",
  },
  {
    symbol: "GBPUSD",
    name: "British Pound / US Dollar",
    assetClass: "forex",
    baseCurrency: "GBP",
    quoteCurrency: "USD",
    contractSize: "100000",
    currentPrice: "1.30000",
  },
  {
    symbol: "USDJPY",
    name: "US Dollar / Japanese Yen",
    assetClass: "forex",
    baseCurrency: "USD",
    quoteCurrency: "JPY",
    contractSize: "100000",
    currentPrice: "150.000",
  },
  {
    symbol: "BTCUSD",
    name: "Bitcoin / US Dollar",
    assetClass: "crypto",
    baseCurrency: "BTC",
    quoteCurrency: "USD",
    contractSize: "1",
    currentPrice: "60000.00",
  },
  {
    symbol: "ETHUSD",
    name: "Ethereum / US Dollar",
    assetClass: "crypto",
    baseCurrency: "ETH",
    quoteCurrency: "USD",
    contractSize: "1",
    currentPrice: "3000.00",
  },
  {
    symbol: "XAUUSD",
    name: "Gold / US Dollar",
    assetClass: "commodity",
    baseCurrency: "XAU",
    quoteCurrency: "USD",
    contractSize: "100",
    currentPrice: "2300.00",
  },
];

/**
 * Seed default instruments only when the collection is empty.
 * Existing instrument records are not overwritten.
 */
const ensureDefaultInstruments = async () => {
  const count = await MarketInstrument.countDocuments({});

  if (count > 0) {
    return;
  }

  const operations = DEFAULT_INSTRUMENTS.map((instrument) => ({
    updateOne: {
      filter: { symbol: instrument.symbol },
      update: {
        $setOnInsert: {
          ...instrument,
          priceSource: "simulated",
          isActive: true,
          priceUpdatedAt: new Date(),
        },
      },
      upsert: true,
    },
  }));

  try {
    await MarketInstrument.bulkWrite(operations, {
      ordered: false,
    });
  } catch (error) {
    // Another request may have seeded the instruments simultaneously.
    // Ignore duplicate-key races, but propagate other database errors.
    if (error.code !== 11000 && error.code !== 11001) {
      throw error;
    }
  }
};

exports.listInstruments = async ({ assetClass } = {}) => {
  await ensureDefaultInstruments();

  const filter = { isActive: true };

  if (assetClass) {
    filter.assetClass = assetClass;
  }

  return MarketInstrument.find(filter)
    .select(
      "symbol name assetClass baseCurrency quoteCurrency contractSize currentPrice priceSource priceUpdatedAt"
    )
    .sort({ assetClass: 1, symbol: 1 })
    .lean();
};

exports.getInstrumentBySymbol = async (symbol) => {
  await ensureDefaultInstruments();

  return MarketInstrument.findOne({
    symbol: String(symbol).trim().toUpperCase(),
    isActive: true,
  });
};

exports.DEFAULT_INSTRUMENTS = DEFAULT_INSTRUMENTS;
