const KYC = require("../models/KYCModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const cloudinary = require("../config/cloudinary");
const { createSecurityAuditLog } = require("../utils/securityAudit");

/*
=====================================================
ADMIN: GET SECURE KYC DOCUMENT
GET /api/v1/kyc/admin/:id/document/:documentType
=====================================================

documentType:

documentFront
documentBack
selfie

Only authenticated administrators can access this route.

A short-lived signed Cloudinary URL is generated.
=====================================================
*/

exports.getKycDocument = catchAsync(async (req, res, next) => {
  const { id, documentType } = req.params;

  const allowedDocumentTypes = ["documentFront", "documentBack", "selfie"];

  if (!allowedDocumentTypes.includes(documentType)) {
    return next(new AppError("Invalid KYC document type.", 400));
  }

  const kyc = await KYC.findById(id);

  if (!kyc) {
    return next(new AppError("KYC application not found.", 404));
  }

  /*
   * Only documents that have actually been uploaded
   * can be accessed.
   */
  const document = kyc[documentType];

  if (!document || !document.storageKey) {
    return next(
      new AppError("The requested KYC document has not been uploaded.", 404),
    );
  }

  /*
   * Generate a signed URL that expires quickly.
   *
   * 5 minutes = 300 seconds.
   */
  const signedUrl = cloudinary.url(document.storageKey, {
    resource_type: "image",
    type: "authenticated",
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + 300,
  });

  /*
   * Record that an administrator accessed
   * a sensitive KYC document.
   *
   * Do NOT log the document URL.
   */
  await createSecurityAuditLog({
    userId: kyc.user,
    event: "KYC_DOCUMENT_ACCESSED",
    description: "Administrator accessed a KYC document.",
    req,
    metadata: {
      kycId: kyc._id,
      documentType,
      accessedBy: req.user._id,
    },
  });

  res.status(200).json({
    status: "success",
    data: {
      documentType,
      expiresIn: 300,
      url: signedUrl,
    },
  });
});
