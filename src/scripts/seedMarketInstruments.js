require("dotenv").config();

const mongoose = require("mongoose");
const MarketInstrument = require("../src/models/MarketInstrumentModel");
const { DEFAULT_INSTRUMENTS } = require("../src/services/marketDataService");

async function seedMarketInstruments() {
  try {
    // IMPORTANT: Use the same environment variable your server
    // actually uses to connect to MongoDB.
    const mongoUri = process.env.MONGODB_URL;

    if (!mongoUri) {
      throw new Error(
        "MONGODB_URL is missing. Check the environment variable used by server.js.",
      );
    }

    await mongoose.connect(mongoUri);

    for (const item of DEFAULT_INSTRUMENTS) {
      const { currentPrice, ...details } = item;

      await MarketInstrument.updateOne(
        { symbol: item.symbol },
        {
          $setOnInsert: {
            ...details,
            currentPrice: mongoose.Types.Decimal128.fromString(currentPrice),
            contractSize: mongoose.Types.Decimal128.fromString("1"),
            priceSource: "simulated",
            isActive: true,
            priceUpdatedAt: new Date(),
          },
        },
        { upsert: true },
      );
    }

    console.log("Example market instruments seeded successfully.");
  } catch (error) {
    console.error("Market instrument seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

seedMarketInstruments();
