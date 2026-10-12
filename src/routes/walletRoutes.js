const express = require("express");

const walletController = require("../controllers/WalletController");
const { protect } = require("../middlewares/authMiddlewares");

const router = express.Router();

// All wallet routes require authentication.
router.use(protect);

// Get the user's single wallet.
router.get("/", walletController.getMyWallet);

// Get wallet ledger history.
router.get("/ledger", walletController.getMyLedger);

// Change the display currency without converting the balance.
router.patch(
  "/display-currency",
  walletController.updateMyDisplayCurrency
);

module.exports = router;