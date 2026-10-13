const Decimal = require("decimal.js");

const toDecimal = (value, fieldName) => {
  if (value === undefined || value === null) {
    throw new Error(`${fieldName} is missing.`);
  }

  const result = new Decimal(value.toString());

  if (!result.isFinite()) {
    throw new Error(`${fieldName} is invalid.`);
  }

  return result;
};

const utcDateString = (date = new Date()) => date.toISOString().slice(0, 10);

const money = (value) => value.toDecimalPlaces(8, Decimal.ROUND_HALF_UP);

exports.evaluateAccountRisk = async (account, session) => {
  const today = utcDateString();

  const balance = toDecimal(account.balance, "Balance");
  const equity = toDecimal(account.equity, "Equity");
  const initialBalance = toDecimal(account.initialBalance, "Initial balance");

  let dailyStartingEquity = toDecimal(
    account.dailyStartingEquity,
    "Daily starting equity",
  );

  let highestEquity = toDecimal(account.highestEquity, "Highest equity");

  const dailyLossPercent = toDecimal(
    account.maxDailyLossPercent,
    "Maximum daily loss percentage",
  );

  const overallDrawdownPercent = toDecimal(
    account.maxOverallDrawdownPercent,
    "Maximum overall drawdown percentage",
  );

  const profitTargetPercent = toDecimal(
    account.profitTargetPercent,
    "Profit target percentage",
  );

  if (
    initialBalance.lte(0) ||
    dailyStartingEquity.lt(0) ||
    dailyLossPercent.lt(0) ||
    overallDrawdownPercent.lt(0) ||
    profitTargetPercent.lt(0)
  ) {
    throw new Error("Trading account risk settings are invalid.");
  }

  // Update the daily baseline once per UTC calendar day.
  if (account.dailyLossDate !== today) {
    dailyStartingEquity = equity;
    account.dailyStartingEquity = money(dailyStartingEquity).toString();
    account.dailyLossDate = today;
  }

  if (equity.gt(highestEquity)) {
    highestEquity = equity;
    account.highestEquity = money(highestEquity).toString();
  }

  const dailyLossLimit = dailyStartingEquity.times(dailyLossPercent.div(100));

  const dailyLoss = dailyStartingEquity.minus(equity);

  const overallDrawdownLimit = initialBalance.times(
    overallDrawdownPercent.div(100),
  );

  const overallDrawdown = initialBalance.minus(equity);

  const profitTarget = initialBalance.times(
    new Decimal(1).plus(profitTargetPercent.div(100)),
  );

  let riskEvent = null;

  // Preserve an existing terminal status.
  if (
    account.status === "breached" ||
    account.status === "completed" ||
    account.status === "closed"
  ) {
    return {
      account,
      allowedToTrade: false,
      riskEvent: account.status,
      metrics: {
        dailyLoss: money(dailyLoss).toFixed(2),
        dailyLossLimit: money(dailyLossLimit).toFixed(2),
        overallDrawdown: money(overallDrawdown).toFixed(2),
        overallDrawdownLimit: money(overallDrawdownLimit).toFixed(2),
        profitTarget: money(profitTarget).toFixed(2),
      },
    };
  }

  // A paused account remains paused.
  if (account.status === "paused") {
    await account.save({ session });

    return {
      account,
      allowedToTrade: false,
      riskEvent: "paused",
    };
  }

  // Apply loss rules before checking the profit target.
  if (
    dailyStartingEquity.gt(0) &&
    dailyLoss.gte(dailyLossLimit) &&
    dailyLoss.gt(0)
  ) {
    account.status = "breached";
    account.breachedAt = new Date();
    riskEvent = "daily_loss_limit";
  } else if (
    overallDrawdown.gt(0) &&
    overallDrawdown.gte(overallDrawdownLimit)
  ) {
    account.status = "breached";
    account.breachedAt = new Date();
    riskEvent = "maximum_overall_drawdown";
  } else if (
    account.accountType !== "demo" &&
    profitTargetPercent.gt(0) &&
    equity.gte(profitTarget)
  ) {
    account.status = "completed";
    account.closedAt = new Date();
    riskEvent = "profit_target_reached";
  }

  await account.save({ session });

  return {
    account,
    allowedToTrade: account.status === "active",
    riskEvent,
    metrics: {
      balance: money(balance).toFixed(2),
      equity: money(equity).toFixed(2),
      dailyStartingEquity: money(dailyStartingEquity).toFixed(2),
      dailyLoss: money(dailyLoss).toFixed(2),
      dailyLossLimit: money(dailyLossLimit).toFixed(2),
      overallDrawdown: money(overallDrawdown).toFixed(2),
      overallDrawdownLimit: money(overallDrawdownLimit).toFixed(2),
      profitTarget: money(profitTarget).toFixed(2),
    },
  };
};
