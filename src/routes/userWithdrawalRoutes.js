const express = require("express");

const withdrawalController = require("../controllers/userWithdrawalController");

const { protect } = require("../middlewares/authMiddlewares");

const router = express.Router();

/*
=====================================================
ALL WITHDRAWAL ROUTES REQUIRE AUTHENTICATION
=====================================================
*/

router.use(protect);

/*
=====================================================
CREATE WITHDRAWAL
=====================================================
*/

router.post("/", withdrawalController.createWithdrawal);

/*
=====================================================
GET MY WITHDRAWALS
=====================================================
*/

router.get("/", withdrawalController.getMyWithdrawals);

/*
=====================================================
GET SINGLE WITHDRAWAL
=====================================================
*/

router.get("/:id", withdrawalController.getMyWithdrawal);

module.exports = router;
