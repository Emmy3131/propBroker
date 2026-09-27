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

module.exports = router;
