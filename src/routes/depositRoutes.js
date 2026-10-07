const express = require("express");

const depositController = require("../controllers/depositController");

const {
    protect,
    restrictTo,
} = require("../middlewares/authMiddlewares");

const router = express.Router();

/*
=====================================================
ALL DEPOSIT ROUTES REQUIRE AUTHENTICATION
=====================================================
*/

router.use(protect);

/*
=====================================================
USER PAYMENT METHODS
=====================================================
*/

router.get(
    "/payment-methods",
    depositController.getDepositPaymentMethods
);

/*
=====================================================
USER CREATE DEPOSIT
=====================================================
*/

router.post(
    "/",
    depositController.createDeposit
);

/*
=====================================================
USER GET MY DEPOSITS
=====================================================
*/

router.get(
    "/",
    depositController.getMyDeposits
);

/*
=====================================================
USER GET DEPOSIT BY REFERENCE
=====================================================
*/

router.get(
    "/reference/:reference",
    depositController.getMyDepositByReference
);

/*
=====================================================
USER SUBMIT PAYMENT
=====================================================

POST /api/v1/deposits/:id/submit

Example:

POST /api/v1/deposits/690abc123/submit

Body:

{
    "transactionReference": "TRX123456789",
    "userNote": "Payment made through my bank account."
}

This changes:

pending
   ↓
submitted
=====================================================
*/

router.post(
    "/:id/submit",
    depositController.submitPayment
);

/*
=====================================================
ADMIN ROUTES
=====================================================

Admin routes must come before GET /:id.
=====================================================
*/

router.use(
    "/admin",
    restrictTo("admin")
);

/*
=====================================================
ADMIN GET ALL DEPOSITS
=====================================================
*/

router.get(
    "/admin",
    depositController.getAdminDeposits
);

/*
=====================================================
ADMIN GET SINGLE DEPOSIT
=====================================================
*/

router.get(
    "/admin/:id",
    depositController.getAdminDeposit
);

/*
=====================================================
ADMIN REVIEW DEPOSIT
=====================================================
*/

router.patch(
    "/admin/:id/review",
    depositController.reviewDeposit
);

/*
=====================================================
ADMIN APPROVE DEPOSIT
=====================================================
*/

router.post(
    "/admin/:id/approve",
    depositController.approveDeposit
);

/*
=====================================================
ADMIN REJECT DEPOSIT
=====================================================
*/

router.post(
    "/admin/:id/reject",
    depositController.rejectDeposit
);

/*
=====================================================
USER GET SINGLE DEPOSIT
=====================================================

Keep this LAST because :id is a generic parameter.
=====================================================
*/

router.get(
    "/:id",
    depositController.getMyDeposit
);

module.exports = router;