const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const hpp = require("hpp");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const globalErrorHandler = require("./src/middlewares/errorMiddlewares");
const AppError = require("./src/utils/appError");

const userRoute = require("./src/routes/userRoutes");
const authRoutes = require("./src/routes/authRoutes");
const kycRoutes = require("./src/routes/kycRoutes");
const walletRoute = require("./src/routes/walletRoutes");
const depositRoutes = require("./src/routes/depositRoutes");
const paystackWebhookRoutes = require("./src/routes/paystackWebhookRoutes");
const paystackCallbackRoutes = require("./src/routes/paystackCallbackRoutes");

const app = express();

/*
=====================================================
TRUST VERCEL PROXY
=====================================================
*/

app.set("trust proxy", 1);

/*
=====================================================
COOKIE PARSER
=====================================================
*/

app.use(cookieParser());

/*
=====================================================
SECURITY
=====================================================
*/

app.use(helmet());

/*
=====================================================
CORS
=====================================================
*/

const allowedOrigins = [
  "http://localhost:5173",
  "https://prop-broker-front-end.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow Postman, server-to-server requests,
      // and requests without an Origin header.
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new AppError("This origin is not allowed to access this API.", 403),
      );
    },

    credentials: true,

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  }),
);

/*
=====================================================
BODY PARSING
=====================================================
*/

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  }),
);

app.use(
  express.urlencoded({
    extended: true,
  }),
);

/*
=====================================================
SECURITY MIDDLEWARE
=====================================================
*/

app.use(hpp());

/*
=====================================================
GLOBAL RATE LIMITER
=====================================================
*/

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,

  max: 100,

  standardHeaders: true,

  legacyHeaders: false,

  message: {
    status: "fail",
    message: "Too many requests from this IP, please try again in an hour.",
  },
});

app.use("/api/v1", limiter);

/*
=====================================================
QUERY PARSER
=====================================================
*/

app.set("query parser", "extended");

/*
====================================================
Paystack webhook routes
====================================================
*/
app.use("/api/v1/webhooks/paystack", paystackWebhookRoutes);
app.use("/api/v1/payments", paystackCallbackRoutes);

/*
=====================================================
AUTH ROUTES
=====================================================
*/

app.use("/api/v1/auth", authRoutes);

/*
=====================================================
USER ROUTES
=====================================================
*/

app.use("/api/v1/users", userRoute);

/*
=====================================================
KYC ROUTES
=====================================================
*/
app.use("/api/v1/kyc", kycRoutes);

//others routes

app.use("/api/v1/wallet", walletRoute);
app.use("/api/v1/deposit", depositRoutes);

/*
=====================================================
UNKNOWN ROUTE HANDLER
=====================================================
*/

app.use((req, res, next) => {
  next(new AppError(`Cannot find ${req.originalUrl} on this server.`, 404));
});

/*
=====================================================
GLOBAL ERROR HANDLER
=====================================================
*/

app.use(globalErrorHandler);

/*
=====================================================
EXPORT
=====================================================
*/

module.exports = app;
