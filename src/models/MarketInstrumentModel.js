const mongoose = require("mongoose");

const marketInstrumentSchema = new mongoose.Schema(
  {
    symbol: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    assetClass: {
      type: String,
      enum: ["forex", "crypto", "index", "commodity", "stock"],
      required: true,
    },

    baseCurrency: {
      type: String,
      default: null,
    },

    quoteCurrency: {
      type: String,
      default: "USD",
      required: true,
      uppercase: true,
      trim: true,
    },

    // Contract units represented by one lot.
    contractSize: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      default: () => mongoose.Types.Decimal128.fromString("1"),
      validate: {
        validator: (value) => value != null && Number(value.toString()) > 0,
        message: "Contract size must be greater than zero.",
      },
    },

    // Current stored quote. Static test prices are not live prices.
    currentPrice: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: (value) => value != null && Number(value.toString()) > 0,
        message: "Instrument price must be greater than zero.",
      },
    },

    priceSource: {
      type: String,
      enum: ["simulated", "external"],
      default: "simulated",
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    priceUpdatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Indexes
marketInstrumentSchema.index(
  { isActive: 1, assetClass: 1 },
  { name: "active_instruments_by_class" },
);

module.exports = mongoose.model("MarketInstrument", marketInstrumentSchema);
