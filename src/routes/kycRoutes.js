const express = require("express");

const kycController = require("./../controllers/kycControllers");
const { protect, restrictTo } = require("./../middlewares/authMiddlewares");
const kycDocumentController = require("./../controllers/kycDocumentsController");

const router = express.Router();

/*
=====================================================
ALL KYC ROUTES REQUIRE AUTHENTICATION
=====================================================
*/
router.use(protect);

/*
=====================================================
USER KYC ROUTES
=====================================================
*/

router.get("/me", kycController.getMyKyc);

router.post("/", kycController.createKyc);

router.patch("/", kycController.updateKyc);

router.post("/submit", kycController.submitKyc);

router.post("/.document", kycController.uploadDocuments);

/*
=====================================================
ADMIN KYC ROUTES
=====================================================
*/

router.get("/admin", restrictTo("admin"), kycController.getAllKyc);

router.get("/admin/:id", restrictTo("admin"), kycController.getKycById);

router.patch(
  "/admin/:id/approve",
  restrictTo("admin"),
  kycController.approveKyc,
);

router.patch("/admin/:id/reject", restrictTo("admin"), kycController.rejectKyc);

router.get(
  "/admin/:id/document/:documentType",
  restrictTo("admin"),
  kycDocumentController.getKycDocument,
);

module.exports = router;
