const express = require("express");

const {
  handlePaystackCallback,
} = require("../controllers/paystackCallbackController");

const router = express.Router();

router.get("/paystack/callback", handlePaystackCallback);

module.exports = router;
