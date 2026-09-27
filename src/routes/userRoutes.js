const express = require("express");

const router = express.Router();

const userController = require("./../controllers/userController");

const { protect, restrictTo } = require("./../middlewares/authMiddlewares");

/*
=====================================================
PUBLIC / BASIC USER ROUTES
=====================================================
*/

// Create user
router
  .route("/")
  .post(userController.createUser)
  .get(userController.getAllUsers);

/*
=====================================================
AUTHENTICATED USER PROFILE ROUTES
=====================================================
*/

/*
GET CURRENT LOGGED-IN USER PROFILE

GET /api/v1/users/me
*/
router.get("/me", protect, userController.getMyProfile);

/*
UPDATE CURRENT LOGGED-IN USER PROFILE

PATCH /api/v1/users/me
*/
router.patch("/me", protect, userController.updateMyProfile);

/*
CHANGE CURRENT USER PASSWORD

PATCH /api/v1/users/me/password
*/
router.patch("/me/password", protect, userController.changeMyPassword);

/*
=====================================================
USER DASHBOARD
=====================================================
*/

router.get("/dashboard", protect, (req, res) => {
  res.status(200).json({
    status: "success",
    message: "Welcome to dashboard",
    user: req.user,
  });
});

/*
=====================================================
ADMIN ROUTE
=====================================================
*/

router.get("/admin", protect, restrictTo("admin"), (req, res) => {
  res.status(200).json({
    status: "success",
    message: "Welcome admin",
    user: req.user,
  });
});

/*
=====================================================
USER BY ID
=====================================================
*/

router
  .route("/:id")
  .get(protect, userController.getUserById)
  .patch(protect, userController.updateUser)
  .delete(protect, restrictTo("admin"), userController.deleteUser);

module.exports = router;
