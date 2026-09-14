const express = require("express");

const authController = require("../controllers/authController");

const { protect } = require("../middlewares/authMiddlewares");

const protectCsrf = require("../middlewares/csrfMiddlewares");

const { loginLimiter } = require("../middlewares/rateLimiters");

const twoFactorController = require("../controllers/2FAChallengeController");

const router = express.Router();

/*
=====================================================
PUBLIC AUTH ROUTES
=====================================================
*/

router.post("/signup", authController.signup);

router.post("/login", loginLimiter, authController.login);

router.get("/verify-email/:token", authController.verifyEmail);

router.post("/resend-verification", authController.resendVerification);

router.post("/forgot-password", authController.forgotPassword);

router.patch("/reset-password/:token", authController.resetPassword);

/*
=====================================================
SESSION ROUTES
=====================================================
*/

router.post("/refresh", protectCsrf, authController.refreshAccessToken);

router.post("/logout", protectCsrf, authController.logout);

router.post(
  "/logout-all",
  protect,
  protectCsrf,
  authController.logoutAllSessions,
);

/*
=====================================================
PROTECTED ROUTES
=====================================================
*/

router.get("/me", protect, authController.getMe);

// =========================================================
// TWO-FACTOR AUTHENTICATION
// =========================================================

router.post("/2fa/setup", protect, twoFactorController.setupTwoFactor);

router.post(
  "/2fa/verify-setup",
  protect,
  twoFactorController.verifyTwoFactorSetup,
);

router.post(
  "/2fa/disable",
  protect,
  protectCsrf,
  twoFactorController.disableTwoFactor,
);

router.post("/2fa/verify-login", twoFactorController.verifyLoginTwoFactor);

module.exports = router;
