const express = require("express");
const userRoute = require("./src/routes/userRoutes");
const authRoutes = require("./src/routes/authRoutes");
const helmet = require("helmet");
const app = express();
const rateLimit = require("express-rate-limit");
const hpp = require("hpp");

app.use(helmet());
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



app.get("/", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "EmmCore Global Networks API is running",
  });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoute);

module.exports = app;
