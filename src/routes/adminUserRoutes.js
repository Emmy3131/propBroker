const express = require("express");

const adminUserController = require("../controllers/adminUserController");

const { protect, restrictTo } = require("../middlewares/authMiddlewares");

const router = express.Router();

// =========================================================
// ALL ADMIN USER ROUTES
// =========================================================

router.use(protect);
router.use(restrictTo("admin"));

// =========================================================
// USER STATISTICS
// IMPORTANT: /stats MUST COME BEFORE /:id
// =========================================================

router.get("/stats", adminUserController.getUserStats);

// =========================================================
// GET ALL USERS
// =========================================================

router.get("/", adminUserController.getAllUsers);



router.get("/:id/details", adminUserController.getUserDetails);

// =========================================================
// GET SINGLE USER
// =========================================================

router.get("/:id", adminUserController.getUser);

module.exports = router;
