const multer = require("multer");
const path = require("path");

const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return cb(
      new Error(
        "Invalid file type. Only JPEG, PNG and WebP images are allowed.",
      ),
      false,
    );
  }

  cb(null, true);
};

const uploadKyc = multer({
  storage,

  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 3,
  },

  fileFilter,
});

module.exports = uploadKyc;
