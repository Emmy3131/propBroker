const express = require("express");

const {
  handlePaystackWebhook,
} = require("../controllers/paystackWebhookController");

const router = express.Router();

router.post("/", handlePaystackWebhook);

module.exports = router;
