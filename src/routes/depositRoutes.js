const express = require("express");

const depositController = require("../controllers/depositController");

const { protect } = require("../middlewares/authMiddlewares");

const router = express.Router();

/*
=====================================================
ALL DEPOSIT ROUTES REQUIRE AUTHENTICATION
=====================================================
*/

router.use(protect);

/*
=====================================================
CREATE DEPOSIT
=====================================================
*/

router.post("/", depositController.createDeposit);

/*
=====================================================
GET MY DEPOSITS
=====================================================
*/

router.get("/", depositController.getMyDeposits);

/*
=====================================================
GET SINGLE DEPOSIT
=====================================================
*/
router.get( "/reference/:reference", depositController.getMyDepositByReference );

router.get("/:id", depositController.getMyDeposit);

module.exports = router;
