const express = require("express");
const marketController = require("../controllers/marketController");
const { protect } = require("../middlewares/authMiddlewares");

const router = express.Router();

router.use(protect);

router.get("/instruments", marketController.getInstruments);
router.get("/instruments/:symbol", marketController.getInstrument);
router.patch(
  "/instruments/:symbol/price",
  protect,
  marketController.updateSimulatedPrice,
);

module.exports = router;
