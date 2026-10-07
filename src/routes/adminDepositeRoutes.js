const express = require("express");

const depositController = require("../controllers/depositController");

const { protect, restrictTo } = require("../middlewares/authMiddlewares");

const router = express.Router();

/*
=====================================================
ALL ADMIN DEPOSIT ROUTES REQUIRE AUTHENTICATION
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
GET ALL DEPOSITS
=====================================================
*/

router.get("/", depositController.getAdminDeposits);

/*
=====================================================
GET SINGLE DEPOSIT
=====================================================
*/

router.get("/:id", depositController.getAdminDeposit);

/*
=====================================================
REVIEW DEPOSIT
=====================================================
*/

router.patch("/:id/review", depositController.reviewDeposit);

/*
=====================================================
APPROVE DEPOSIT
=====================================================
*/

router.post("/:id/approve", depositController.approveDeposit);

/*
=====================================================
REJECT DEPOSIT
=====================================================
*/

router.post("/:id/reject", depositController.rejectDeposit);

module.exports = router;
