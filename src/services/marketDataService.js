
const MarketInstrument = require("../models/MarketInstrumentModel");

// Example prices only. These are not live quotes.
const DEFAULT_INSTRUMENTS = [
  {
    symbol: "EURUSD",
    name: "Euro / US Dollar",
    assetClass: "forex",
    baseCurrency: "EUR",
    quoteCurrency: "USD",
    currentPrice: "1.10000",
  },
  {
    symbol: "GBPUSD",
    name: "British Pound / US Dollar",
    assetClass: "forex",
    baseCurrency: "GBP",
    quoteCurrency: "USD",
    currentPrice: "1.30000",
  },
  {
    symbol: "USDJPY",
    name: "US Dollar / Japanese Yen",
    assetClass: "forex",
    baseCurrency: "USD",
    quoteCurrency: "JPY",
    currentPrice: "150.000",
  },
  {
    symbol: "BTCUSD",
    name: "Bitcoin / US Dollar",
    assetClass: "crypto",
    baseCurrency: "BTC",
    quoteCurrency: "USD",
    currentPrice: "60000.00",
  },
  {
    symbol: "ETHUSD",
    name: "Ethereum / US Dollar",
    assetClass: "crypto",
    baseCurrency: "ETH",
    quoteCurrency: "USD",
    currentPrice: "3000.00",
  },
  {
    symbol: "XAUUSD",
    name: "Gold / US Dollar",
    assetClass: "commodity",
    baseCurrency: "XAU",
    quoteCurrency: "USD",
    currentPrice: "2300.00",
  },
];

exports.listInstruments = async ({ assetClass } = {}) => {
  const filter = { isActive: true };

  if (assetClass) {
    filter.assetClass = assetClass;
  }

  return MarketInstrument.find(filter)
    .select(
      "symbol name assetClass baseCurrency quoteCurrency currentPrice priceSource priceUpdatedAt"
    )
    .sort({ assetClass: 1, symbol: 1 })
    .lean();
};

exports.getInstrumentBySymbol = async (symbol) => {
  return MarketInstrument.findOne({
    symbol: String(symbol).trim().toUpperCase(),
    isActive: true,
  });
};

exports.DEFAULT_INSTRUMENTS = DEFAULT_INSTRUMENTS;
