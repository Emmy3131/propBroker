const marketDataService = require("../services/marketDataService");
const simulatedPriceService = require("../services/simulatedPriceService");

exports.getInstruments = async (req, res, next) => {
  try {
    const { assetClass } = req.query;

    const supportedClasses = ["forex", "crypto", "index", "commodity", "stock"];

    if (
      assetClass &&
      !supportedClasses.includes(String(assetClass).toLowerCase())
    ) {
      return res.status(400).json({
        status: "error",
        message: "Unsupported asset class filter.",
      });
    }

    const instruments = await marketDataService.listInstruments({
      assetClass: assetClass ? String(assetClass).toLowerCase() : undefined,
    });

    return res.status(200).json({
      status: "success",
      results: instruments.length,
      data: {
        priceMode: "simulated",
        instruments,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.getInstrument = async (req, res, next) => {
  try {
    const instrument = await marketDataService.getInstrumentBySymbol(
      req.params.symbol,
    );

    if (!instrument) {
      return res.status(404).json({
        status: "error",
        message: "Instrument not found or inactive.",
      });
    }

    return res.status(200).json({
      status: "success",
      data: {
        priceMode: "simulated",
        instrument,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.updateSimulatedPrice = async (req, res) => {
  try {
    // Only administrators can manually change simulated prices.
    if (req.user.role !== "admin") {
      return res.status(403).json({
        status: "error",
        message: "Administrator access is required.",
      });
    }

    const result = await simulatedPriceService.updateSimulatedPrice({
      symbol: req.params.symbol,
      price: req.body.price,
    });

    return res.status(200).json({
      status: "success",
      message: "Simulated price updated successfully.",
      data: result,
    });
  } catch (error) {
    const clientErrors = [
      "Instrument symbol is required.",
      "Price is missing.",
      "Price is invalid.",
      "Price must be greater than zero.",
      "Active instrument not found.",
      "Only USD-quoted simulated instruments can be updated.",
    ];

    const isClientError = clientErrors.includes(error.message);

    console.error("Simulated price update error:", error);

    return res.status(isClientError ? 400 : 500).json({
      status: "error",
      message: isClientError
        ? error.message
        : "Unable to update the simulated price.",
    });
  }
};
