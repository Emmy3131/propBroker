const express = require("express");

const withdrawalController = require("../controllers/userWithdrawalController");

const { protect, restrictTo } = require("../middlewares/authMiddlewares");

const router = express.Router();

/*
=====================================================
ALL ADMIN WITHDRAWAL ROUTES REQUIRE AUTHENTICATION
=====================================================
*/

router.use(protect);

/*
=====================================================
ADMIN ONLY
=====================================================
*/

router.use(restrictTo("admin"));

/*
=====================================================
WITHDRAWAL LIST
=====================================================
*/

router.get("/", withdrawalController.getAdminWithdrawals);

/*
=====================================================
SINGLE WITHDRAWAL
=====================================================
*/

router.get("/:id", withdrawalController.getAdminWithdrawal);

/*
=====================================================
REVIEW
=====================================================
*/

router.patch("/:id/review", withdrawalController.reviewWithdrawal);

/*
=====================================================
APPROVE
=====================================================
*/

router.patch("/:id/approve", withdrawalController.approveWithdrawal);

/*
=====================================================
REJECT
=====================================================
*/

router.patch("/:id/reject", withdrawalController.rejectWithdrawal);

/*
=====================================================
PROCESS
=====================================================
*/

router.patch("/:id/process", withdrawalController.processWithdrawal);

/*
=====================================================
MARK SUCCESSFUL
=====================================================
*/

router.patch("/:id/success", withdrawalController.markWithdrawalSuccessful);

/*
=====================================================
CANCEL
=====================================================
*/

router.patch("/:id/cancel", withdrawalController.cancelWithdrawal);

module.exports = router;
