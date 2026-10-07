const express = require("express");

const paymentMethodController = require("../controllers/paymentMethodController");

const { protect, restrictTo } = require("../middlewares/authMiddlewares");

const router = express.Router();

/*
=====================================================
ADMIN ROUTES
=====================================================
*/

router.use(protect);

/*
=====================================================
USER
GET ACTIVE PAYMENT METHODS
=====================================================

This must come before /:id so "active" isn't
mistaken for a MongoDB ID.
*/

router.get("/active", paymentMethodController.getActivePaymentMethods);

/*
=====================================================
ADMIN ONLY
=====================================================
*/

router.use(restrictTo("admin"));

router
  .route("/")
  .get(paymentMethodController.getAllPaymentMethods)
  .post(paymentMethodController.createPaymentMethod);

router
  .route("/:id")
  .get(paymentMethodController.getPaymentMethod)
  .patch(paymentMethodController.updatePaymentMethod)
  .delete(paymentMethodController.deletePaymentMethod);

module.exports = router;
