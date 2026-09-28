const express = require("express");

const sessionController = require("../controllers/SessionController");

const {
  protect,
} = require("../middlewares/authMiddlewares");

const router = express.Router();

router.use(protect);

router.get(
  "/",
  sessionController.getMySessions
);

router.delete(
  "/:id",
  sessionController.revokeSession
);

module.exports = router;