const KYC = require("../models/KYCModel");
const User = require("../models/UserModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { createSecurityAuditLog } = require("../utils/securityAudit");
const { uploadKycDocument } = require("../utils/uploadKycDocument");

/*
=====================================================
GET MY KYC
GET /api/v1/kyc/me
=====================================================
*/
exports.getMyKyc = catchAsync(async (req, res, next) => {
  const kyc = await KYC.findOne({
    user: req.user._id,
  }).select("-documentFront -documentBack -selfie -identityDocumentNumber");

  if (!kyc) {
    return res.status(200).json({
      status: "success",
      data: {
        kyc: null,
      },
    });
  }

  res.status(200).json({
    status: "success",
    data: {
      kyc,
    },
  });
});

/*
=====================================================
CREATE KYC
POST /api/v1/kyc
=====================================================
*/
exports.createKyc = catchAsync(async (req, res, next) => {
  const existingKyc = await KYC.findOne({
    user: req.user._id,
  });

  if (existingKyc) {
    return next(
      new AppError(
        "You already have a KYC application. Use the update endpoint instead.",
        409,
      ),
    );
  }

  const kyc = await KYC.create({
    user: req.user._id,
    ...req.body,
    status: "pending",
  });

  await User.findByIdAndUpdate(req.user._id, {
    kycStatus: "pending",
  });

  res.status(201).json({
    status: "success",
    message: "KYC application created successfully.",
    data: {
      kyc,
    },
  });
});

/*
=====================================================
UPDATE KYC
PATCH /api/v1/kyc
=====================================================
*/
exports.updateKyc = catchAsync(async (req, res, next) => {
  const kyc = await KYC.findOne({
    user: req.user._id,
  });

  if (!kyc) {
    return next(
      new AppError("KYC application not found. Please create one first.", 404),
    );
  }

  if (kyc.status === "verified") {
    return next(
      new AppError(
        "Your KYC has already been verified and cannot be modified.",
        400,
      ),
    );
  }

  if (kyc.status === "under_review") {
    return next(
      new AppError(
        "Your KYC is currently under review and cannot be modified.",
        400,
      ),
    );
  }

  /*
   * Only allow fields that belong to the KYC document.
   * This prevents users from modifying protected fields such as:
   * status, reviewedBy, verifiedAt, rejectionReason, etc.
   */
  const allowedFields = [
    "firstName",
    "lastName",
    "dateOfBirth",
    "country",
    "address",
    "city",
    "state",
    "postalCode",
    "identityDocumentType",
    "identityDocumentNumber",
    "documentFront",
    "documentBack",
    "selfie",
  ];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      kyc[field] = req.body[field];
    }
  });

  /*
   * If the KYC was previously rejected, updating it means
   * the user is preparing a new submission.
   */
  if (kyc.status === "rejected") {
    kyc.status = "pending";
    kyc.rejectionReason = null;
    kyc.rejectedAt = null;
    kyc.reviewedBy = null;
    kyc.reviewedAt = null;
    kyc.reviewNote = null;
  }

  await kyc.save();

  await User.findByIdAndUpdate(req.user._id, {
    kycStatus: "pending",
  });

  res.status(200).json({
    status: "success",
    message: "KYC information updated successfully.",
    data: {
      kyc,
    },
  });
});

/*
=====================================================
SUBMIT KYC
POST /api/v1/kyc/submit
=====================================================
*/
exports.submitKyc = catchAsync(async (req, res, next) => {
  const kyc = await KYC.findOne({
    user: req.user._id,
  });

  if (!kyc) {
    return next(
      new AppError("KYC application not found. Please create one first.", 404),
    );
  }

  if (kyc.status === "verified") {
    return next(new AppError("Your KYC has already been verified.", 400));
  }

  if (kyc.status === "under_review") {
    return next(new AppError("Your KYC is already under review.", 400));
  }

  /*
   * Required information before submission.
   */
  const requiredFields = [
    "firstName",
    "lastName",
    "dateOfBirth",
    "country",
    "address",
    "city",
    "state",
    "identityDocumentType",
    "identityDocumentNumber",
  ];

  const missingFields = requiredFields.filter(
    (field) =>
      kyc[field] === undefined || kyc[field] === null || kyc[field] === "",
  );

  if (!kyc.documentFront || !kyc.documentFront.storageKey) {
    missingFields.push("documentFront");
  }

  if (
    kyc.identityDocumentType !== "passport" &&
    (!kyc.documentBack || !kyc.documentBack.storageKey)
  ) {
    missingFields.push("documentBack");
  }

  if (!kyc.selfie || !kyc.selfie.storageKey) {
    missingFields.push("selfie");
  }

  if (missingFields.length > 0) {
    return next(
      new AppError(
        `Please complete all required KYC information before submission. Missing: ${missingFields.join(
          ", ",
        )}`,
        400,
      ),
    );
  }

  kyc.status = "under_review";
  kyc.submittedAt = new Date();

  kyc.rejectionReason = null;
  kyc.rejectedAt = null;

  await kyc.save();

  await User.findByIdAndUpdate(req.user._id, {
    kycStatus: "pending",
  });

  await createSecurityAuditLog({
    userId: req.user._id,
    event: "KYC_SUBMITTED",
    description: "User submitted a KYC application for review.",
    req,
    metadata: {
      kycId: kyc._id,
      status: kyc.status,
    },
  });

  res.status(200).json({
    status: "success",
    message: "KYC submitted successfully and is now under review.",
    data: {
      kyc,
    },
  });
});

/*
=====================================================
ADMIN: GET ALL KYC
GET /api/v1/kyc/admin
=====================================================
*/
exports.getAllKyc = catchAsync(async (req, res, next) => {
  const { status, page = 1, limit = 20 } = req.query;

  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 20, 1), 100);

  const filter = {};

  if (status) {
    filter.status = status;
  }

  const skip = (pageNumber - 1) * limitNumber;

  const [kycs, total] = await Promise.all([
    KYC.find(filter)
      .populate("user", "name email phone country")
      .populate("reviewedBy", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber),

    KYC.countDocuments(filter),
  ]);

  res.status(200).json({
    status: "success",
    results: kycs.length,
    pagination: {
      total,
      page: pageNumber,
      limit: limitNumber,
      pages: Math.ceil(total / limitNumber),
    },
    data: {
      kycs,
    },
  });
});

/*
=====================================================
ADMIN: GET SINGLE KYC
GET /api/v1/kyc/admin/:id
=====================================================
*/
exports.getKycById = catchAsync(async (req, res, next) => {
  const kyc = await KYC.findById(req.params.id)
    .populate("user", "name email phone country")
    .populate("reviewedBy", "name email");

  if (!kyc) {
    return next(new AppError("KYC application not found.", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      kyc,
    },
  });
});

/*
=====================================================
ADMIN: GET KYC BY USER ID
GET /api/v1/kyc/admin/user/:userId
=====================================================
*/

exports.getKycByUserId = catchAsync(async (req, res, next) => {
  const kyc = await KYC.findOne({
    user: req.params.userId,
  })
    .populate(
      "user",
      "name email phone country profileImage role status emailVerified twoFactorEnabled",
    )
    .populate("reviewedBy", "name email");

  if (!kyc) {
    return res.status(200).json({
      status: "success",
      data: {
        kyc: null,
      },
    });
  }

  res.status(200).json({
    status: "success",
    data: {
      kyc,
    },
  });
});

/*
=====================================================
ADMIN: APPROVE KYC
PATCH /api/v1/kyc/admin/:id/approve
=====================================================
*/
exports.approveKyc = catchAsync(async (req, res, next) => {
  const kyc = await KYC.findById(req.params.id);

  if (!kyc) {
    return next(new AppError("KYC application not found.", 404));
  }

  if (kyc.status !== "under_review") {
    return next(
      new AppError("Only KYC applications under review can be approved.", 400),
    );
  }

  kyc.status = "verified";
  kyc.reviewedBy = req.user._id;
  kyc.reviewedAt = new Date();
  kyc.verifiedAt = new Date();

  kyc.rejectionReason = null;
  kyc.rejectedAt = null;

  if (req.body.reviewNote) {
    kyc.reviewNote = req.body.reviewNote;
  }

  await kyc.save();

  await User.findByIdAndUpdate(kyc.user, {
    kycStatus: "verified",
    kycVerifiedAt: new Date(),
  });

  await createSecurityAuditLog({
    userId: kyc.user,
    event: "KYC_APPROVED",
    description: "KYC application was approved by an administrator.",
    req,
    metadata: {
      kycId: kyc._id,
      reviewedBy: req.user._id,
    },
  });

  res.status(200).json({
    status: "success",
    message: "KYC application approved successfully.",
    data: {
      kyc,
    },
  });
});

/*
=====================================================
ADMIN: REJECT KYC
PATCH /api/v1/kyc/admin/:id/reject
=====================================================
*/
exports.rejectKyc = catchAsync(async (req, res, next) => {
  const kyc = await KYC.findById(req.params.id);

  if (!kyc) {
    return next(new AppError("KYC application not found.", 404));
  }

  if (kyc.status !== "under_review") {
    return next(
      new AppError("Only KYC applications under review can be rejected.", 400),
    );
  }

  const rejectionReason = req.body.rejectionReason?.trim();

  if (!rejectionReason) {
    return next(new AppError("A rejection reason is required.", 400));
  }

  kyc.status = "rejected";
  kyc.rejectionReason = rejectionReason;
  kyc.reviewedBy = req.user._id;
  kyc.reviewedAt = new Date();
  kyc.rejectedAt = new Date();

  if (req.body.reviewNote) {
    kyc.reviewNote = req.body.reviewNote;
  }

  await kyc.save();

  await User.findByIdAndUpdate(kyc.user, {
    kycStatus: "rejected",
    kycVerifiedAt: null,
  });

  await createSecurityAuditLog({
    userId: kyc.user,
    event: "KYC_REJECTED",
    description: "KYC application was rejected by an administrator.",
    req,
    metadata: {
      kycId: kyc._id,
      reviewedBy: req.user._id,
      reasonProvided: true,
    },
  });

  res.status(200).json({
    status: "success",
    message: "KYC application rejected.",
    data: {
      kyc,
    },
  });
});

/*
=====================================================
UPLOAD KYC DOCUMENTS
POST /api/v1/kyc/documents
=====================================================

Expected multipart/form-data:

documentFront -> ID front
documentBack  -> ID back
selfie        -> Selfie

The actual field names are:

documentFront
documentBack
selfie
=====================================================
*/
exports.uploadDocuments = catchAsync(async (req, res, next) => {
  const kyc = await KYC.findOne({
    user: req.user._id,
  });

  if (!kyc) {
    return next(new AppError("Please create your KYC application first.", 404));
  }

  if (kyc.status === "verified") {
    return next(new AppError("Your KYC has already been verified.", 400));
  }

  if (kyc.status === "under_review") {
    return next(new AppError("Your KYC is currently under review.", 400));
  }

  if (!req.files) {
    return next(new AppError("Please upload at least one KYC document.", 400));
  }

  /*
   * Multer .fields() returns:
   *
   * {
   *   documentFront: [file],
   *   documentBack: [file],
   *   selfie: [file]
   * }
   */

  const uploadedDocuments = {};

  const uploadFile = async (fieldName, documentType) => {
    const files = req.files[fieldName];

    if (!files || !files.length) {
      return;
    }

    const file = files[0];

    const result = await uploadKycDocument({
      buffer: file.buffer,
      userId: req.user._id.toString(),
      documentType,
    });

    uploadedDocuments[fieldName] = {
      storageKey: result.public_id,
      url: result.secure_url,
    };
  };

  await uploadFile("documentFront", "document-front");

  await uploadFile("documentBack", "document-back");

  await uploadFile("selfie", "selfie");

  /*
   * Save only references in MongoDB.
   */
  if (uploadedDocuments.documentFront) {
    kyc.documentFront = uploadedDocuments.documentFront;
  }

  if (uploadedDocuments.documentBack) {
    kyc.documentBack = uploadedDocuments.documentBack;
  }

  if (uploadedDocuments.selfie) {
    kyc.selfie = uploadedDocuments.selfie;
  }

  await kyc.save();

  res.status(200).json({
    status: "success",
    message: "KYC documents uploaded successfully.",
    data: {
      documents: {
        documentFront: Boolean(kyc.documentFront?.storageKey),

        documentBack: Boolean(kyc.documentBack?.storageKey),

        selfie: Boolean(kyc.selfie?.storageKey),
      },
    },
  });
});
