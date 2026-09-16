const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const hpp = require("hpp");
const cors = require("cors");

const userRoute = require("./src/routes/userRoutes");
const authRoutes = require("./src/routes/authRoutes");

const app = express();

/*
=====================================================
TRUST VERCEL PROXY
=====================================================
*/

app.set("trust proxy", 1);

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
    "http://localhost:5174",
    "https://prop-broker.vercel.app",
];

app.use(
    cors({
        origin: function (origin, callback) {
            // Allow Postman, server-to-server and other
            // requests that do not send an Origin header.
            if (!origin) {
                return callback(null, true);
            }

            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            return callback(
                new Error("Not allowed by CORS")
            );
        },

        credentials: true,

        methods: [
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS",
        ],

        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "X-CSRF-Token",
        ],
    })
);

/*
=====================================================
BODY PARSING
=====================================================
*/

app.use(express.json());

app.use(
    express.urlencoded({
        extended: true,
    })
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
        message:
            "Too many requests from this IP, please try again in an hour",
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
=====================================================
AUTH ROUTES
=====================================================
*/

app.use(
    "/api/v1/auth",
    authRoutes
);

/*
=====================================================
USER ROUTES
=====================================================
*/

app.use(
    "/api/v1/users",
    userRoute
);

/*
=====================================================
EXPORT
=====================================================
*/

module.exports = app;