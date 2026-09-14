const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    let databaseURL;

    if (process.env.NODE_ENV === "development") {
      databaseURL = process.env.MONGODB_LOCAL_URL;
    } else if (process.env.NODE_ENV === "production") {
      databaseURL = process.env.MONGODB_ATLAS_URL;
    } else {
      throw new Error(
        `Unsupported NODE_ENV: ${process.env.NODE_ENV}`
      );
    }

    if (!databaseURL) {
      throw new Error(
        `MongoDB URL is missing for ${process.env.NODE_ENV} environment`
      );
    }

    const connection = await mongoose.connect(databaseURL);

    console.log(
      `MongoDB connected: ${connection.connection.host}`
    );

    console.log(
      `Environment: ${process.env.NODE_ENV}`
    );

    return connection;
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    throw error;
  }
};

module.exports = connectDB;