const express = require("express");

const tradingController = require("../controllers/tradingController");
const { protect } = require("../middlewares/authMiddlewares");
const tradeHistoryController = require("../controllers/tradeHistoryController");

const router = express.Router();

router.use(protect);

// Place a simulated market order.
router.post("/orders", tradingController.placeMarketOrder);

// View the authenticated user's orders.
router.get("/orders", tradingController.getMyOrders);

// View the authenticated user's positions.
router.get("/positions", tradingController.getMyPositions);

// Close a specific position by ID.
router.post("/positions/:id/close", tradingController.closePosition);

// Trade history routes
router.get("/history", tradeHistoryController.getTradeHistory);

router.get(
  "/accounts/:accountId/performance",
  tradeHistoryController.getAccountPerformance,
);

module.exports = router;
