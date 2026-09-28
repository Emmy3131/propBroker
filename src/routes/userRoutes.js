const express = require("express");

const router = express.Router();

const userController = require("../controllers/userController");

const {
  protect,
  restrictTo,
} = require("../middlewares/authMiddlewares");


/*
=====================================================
PUBLIC / GENERAL USER ROUTES
=====================================================
*/

router
  .route("/")
  .post(userController.createUser)
  .get(protect, restrictTo("admin"), userController.getAllUsers);


/*
=====================================================
AUTHENTICATED USER PROFILE
=====================================================
*/

router.get(
  "/me",
  protect,
  userController.getMyProfile
);

router.patch(
  "/me",
  protect,
  userController.updateMyProfile
);

router.patch(
  "/me/password",
  protect,
  userController.changeMyPassword
);


/*
=====================================================
DASHBOARD
=====================================================
*/

router.get(
  "/dashboard",
  protect,
  userController.getUserDashboard
);


/*
=====================================================
ADMIN
=====================================================
*/

router.get(
  "/admin",
  protect,
  restrictTo("admin"),
  (req, res) => {
    res.status(200).json({
      status: "success",
      message: "Welcome admin",
      data: {
        user: req.user,
      },
    });
  }
);


/*
=====================================================
USER BY ID
=====================================================
*/

router
  .route("/:id")
  .get(
    protect,
    userController.getUserById
  )
  .patch(
    protect,
    userController.updateUser
  )
  .delete(
    protect,
    restrictTo("admin"),
    userController.deleteUser
  );


module.exports = router;