const express = require("express");
const router = express.Router();

const userController = require("./../controllers/userController");
const {protect, restrictTo} = require("./../middlewares/authMiddlewares");



// USERS ROUTES
router
  .route("/")
  .post(userController.createUser)
  .get(userController.getAllUsers);

router
  .route("/:id")
  .get(protect, userController.getUserById)
  .patch(protect, userController.updateUser)
  .delete(protect, restrictTo, userController.deleteUser);


router.get("/dashboard", protect, (req,res)=>{

  res.json({
    message:"Welcome to dashboard",
    user:req.user
  })

})

// admin route
router.get("/admin", protect, restrictTo("admin"), (req,res)=>{

  res.json({
    message:"Welcome admin"
  })

})


module.exports = router;