const express = require("express");
const userRoute = require("./src/routes/userRoutes");
const authRoutes = require("./src/routes/authRoutes");
const helmet = require("helmet");
const app = express();
const rateLimit = require("express-rate-limit");
const hpp = require("hpp");
const cors = require("cors");

app.use(helmet());

const allowedOrigins = [
  "http://localhost:5173",
  "https://prop-broker.vercel.app/"
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin
      // such as Postman/server-to-server requests
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },

    credentials: true,

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  }),
);

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,

  standardHeaders: true,
  legacyHeaders: false,

  message: {
    status: "fail",
    message: "Too many requests from this IP, please try again in an hour",
  },
});

app.use("/api/v1", limiter);
app.use(hpp());
app.use(express.json());
app.set("query parser", "extended");

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoute);

module.exports = app;
