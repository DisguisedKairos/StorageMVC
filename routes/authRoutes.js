const express = require("express");
const router = express.Router();
const auth = require("../controllers/authController");

router.get("/login", auth.showLogin);
router.post("/login", auth.login);
req.session.user = { id: user.user_id, name: user.name, role: user.role };

router.get("/register", auth.showRegister);
router.post("/register", auth.register);

router.get("/logout", auth.logout);

module.exports = router;
