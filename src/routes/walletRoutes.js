const express = require("express");

const walletController = require("../controllers/WalletController");

const { protect } = require("../middlewares/authMiddlewares");

const router = express.Router();

/*
=====================================================
ALL WALLET ROUTES REQUIRE AUTHENTICATION
=====================================================
*/
router.use(protect);

/*
=====================================================
USER WALLET
=====================================================
*/

router.get("/", walletController.getMyWallet);

router.get("/ledger", walletController.getMyLedger);

// Actual wallet currency conversion
router.patch(
  "/display-currency",
  protect,
  walletController.updateMyDisplayCurrency
);

module.exports = router;
