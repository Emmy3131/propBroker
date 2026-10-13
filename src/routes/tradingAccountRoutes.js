const express = require("express");

const tradingAccountController = require("../controllers/tradingAccountController");

const { protect } = require("../middlewares/authMiddlewares");

const router = express.Router();

// All trading account endpoints require authentication.
router.use(protect);

// Create a simulated trading account.
router.post("/", tradingAccountController.createTradingAccount);

// List the logged-in user's trading accounts.
router.get("/", tradingAccountController.getMyTradingAccounts);

// Retrieve one account belonging to the logged-in user.
router.get("/:id", tradingAccountController.getMyTradingAccount);

module.exports = router;
