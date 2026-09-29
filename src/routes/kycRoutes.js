const express = require("express");

const kycController = require("./../controllers/kycControllers");
const kycDocumentController = require("./../controllers/kycDocumentsController");

const { protect, restrictTo } = require("./../middlewares/authMiddlewares");

const uploadKyc = require("./../middlewares/uploadKyc");

const router = express.Router();

/*
=====================================================
ALL KYC ROUTES REQUIRE AUTHENTICATION
=====================================================
*/

router.use(protect);

/*
=====================================================
USER KYC
=====================================================
*/

router.get("/me", kycController.getMyKyc);

router.post("/", kycController.createKyc);

router.patch("/", kycController.updateKyc);

router.post("/submit", kycController.submitKyc);

/*
=====================================================
UPLOAD KYC DOCUMENTS
=====================================================
*/

router.post(
  "/documents",
  uploadKyc.fields([
    {
      name: "documentFront",
      maxCount: 1,
    },
    {
      name: "documentBack",
      maxCount: 1,
    },
    {
      name: "selfie",
      maxCount: 1,
    },
  ]),
  kycController.uploadDocuments,
);

/*
=====================================================
ADMIN KYC
=====================================================
*/

router.get("/admin", restrictTo("admin"), kycController.getAllKyc);

router.get(
  "/admin/user/:userId",
  restrictTo("admin"),
  kycController.getKycByUserId,
);

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
