const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");

/*
 * Upload a file buffer to Cloudinary.
 */
const uploadKycDocument = ({
  buffer,
  userId,
  documentType,
}) => {
  return new Promise((resolve, reject) => {
    const folder = `emmcore-broker/kyc/${userId}`;

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,

        resource_type: "image",

        public_id: `${documentType}-${Date.now()}`,

        type: "authenticated",

        overwrite: false,

        transformation: [
          {
            width: 2000,
            height: 2000,
            crop: "limit",
            quality: "auto",
            fetch_format: "auto",
          },
        ],
      },

      (error, result) => {
        if (error) {
          return reject(error);
        }

        resolve(result);
      }
    );

    streamifier
      .createReadStream(buffer)
      .pipe(uploadStream);
  });
};

module.exports = {
  uploadKycDocument,
};