// controllers/userController.js
const crypto = require("crypto");
const User = require("../models/User"); // ensure path is correct

module.exports = {
  login(req, res) {
    const { email, password } = req.body;

    // debug line (remove after confirm)
    // console.log("User methods:", Object.keys(User));

    User.findByEmail(email, (err, results) => {
      if (err) { console.error(err); return res.status(500).send("Server error"); }
      if (!results || results.length === 0) return res.send("Invalid email or password");

      const user = results[0];
      const pwHash = crypto.createHash("sha1").update(password).digest("hex");

      if (user.password_hash !== pwHash) {
        return res.send("Invalid email or password");
      }

      // save minimal user in session
      req.session.user = {
        id: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role
      };

      if (user.role === "admin") return res.redirect("/admin/dashboard");
      return res.redirect("/customer/dashboard");
    });
  }
};
