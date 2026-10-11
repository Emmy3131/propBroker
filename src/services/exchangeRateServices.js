const SUPPORTED_CURRENCIES = ["USD", "NGN", "CAD", "EUR"];

const cache = new Map();

const getExchangeRate = async (fromCurrency, toCurrency) => {
  const from = String(fromCurrency).toUpperCase();
  const to = String(toCurrency).toUpperCase();

  if (
    !SUPPORTED_CURRENCIES.includes(from) ||
    !SUPPORTED_CURRENCIES.includes(to)
  ) {
    throw new Error("Unsupported currency.");
  }

  if (from === to) return 1;

  let data = cache.get(from);

  if (!data || data.expiresAt <= Date.now()) {
    const response = await fetch(`https://open.er-api.com/v6/latest/${from}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error("Unable to retrieve exchange rates.");
    }

    data = await response.json();

    if (data.result !== "success" || !data.rates) {
      throw new Error("The exchange-rate provider returned invalid data.");
    }

    const nextUpdate = Number(data.time_next_update_unix) * 1000;

    // Reject missing or stale rate timestamps.
    if (!Number.isFinite(nextUpdate) || nextUpdate <= Date.now()) {
      throw new Error("Exchange rates are expired. Please try again later.");
    }

    cache.set(from, {
      ...data,
      expiresAt: nextUpdate,
    });

    data = cache.get(from);
  }

  const rate = Number(data.rates[to]);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`No exchange rate is available for ${from} to ${to}.`);
  }

  return {
    rate: String(rate),
    rateUpdatedAt: data.time_last_update_utc,
    provider: data.provider || "ExchangeRate-API",
  };
};

module.exports = { getExchangeRate };
