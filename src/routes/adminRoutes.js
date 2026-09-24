const express = require("express");

const adminController = require("../controllers/adminController");

const { protect, restrictTo } = require("../middlewares/authMiddlewares");

const router = express.Router();

// =========================================================
// ADMIN PROTECTED ROUTES
// =========================================================

// GET ADMIN DASHBOARD
router.get(
  "/dashboard",
  protect,
  restrictTo("admin"),
  adminController.getDashboard,
);

module.exports = router;
