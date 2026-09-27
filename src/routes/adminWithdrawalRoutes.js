const express = require("express");

const withdrawalController = require("../controllers/userWithdrawalController");

const { protect, restrictTo } = require("../middlewares/authMiddlewares");

const router = express.Router();

/*
=====================================================
ALL ADMIN WITHDRAWAL ROUTES
=====================================================
*/

router.use(protect);
router.use(restrictTo("admin"));

/*
=====================================================
GET ALL WITHDRAWALS
=====================================================
*/

router.get("/", withdrawalController.getAdminWithdrawals);

module.exports = router;
