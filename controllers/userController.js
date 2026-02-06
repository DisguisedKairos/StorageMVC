// controllers/userController.js
const crypto = require("crypto");
const User = require("../models/User"); // ensure path is correct

function getSessionUserId(req) {
  return req.session.user?.id || req.session.user?.user_id;
}

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
  },

  showProfile(req, res) {
    if (!req.session.user) return res.redirect("/login");

    const userId = getSessionUserId(req);
    User.findById(userId, (err, results) => {
      if (err) {
        const fallbackProfile = {
          user_id: userId,
          name: req.session.user?.name || "",
          email: req.session.user?.email || "",
          role: req.session.user?.role || "customer",
          profile_image: req.session.user?.profileImage || null,
          phone: "",
          address: ""
        };
        return res.render("profile", {
          user: req.session.user,
          profile: fallbackProfile,
          error: null,
          success: null
        });
      }
      const profile = results && results[0] ? results[0] : null;
      if (!profile) {
        const fallbackProfile = {
          user_id: userId,
          name: req.session.user?.name || "",
          email: req.session.user?.email || "",
          role: req.session.user?.role || "customer",
          profile_image: req.session.user?.profileImage || null,
          phone: "",
          address: ""
        };
        return res.render("profile", {
          user: req.session.user,
          profile: fallbackProfile,
          error: null,
          success: null
        });
      }

      res.render("profile", {
        user: req.session.user,
        profile,
        error: null,
        success: null
      });
    });
  },

  updateProfile(req, res) {
    if (!req.session.user) return res.redirect("/login");

    const userId = getSessionUserId(req);
    const body = req.body || {};
    const name = (body.name || "").trim();
    const email = (body.email || "").trim();
    const phone = (body.phone || "").trim();
    const address = (body.address || "").trim();
    const password = (body.password || "").trim();
    const confirmPassword = (body.confirmPassword || "").trim();
    const profileImage = req.file ? req.file.filename : undefined;

    if (!name || !email) {
      return User.findById(userId, (err, results) => {
        const profile = (!err && results && results[0]) ? results[0] : {
          user_id: userId,
          name: req.session.user?.name || "",
          email: req.session.user?.email || "",
          role: req.session.user?.role || "customer",
          profile_image: req.session.user?.profileImage || null,
          phone,
          address
        };
        return res.render("profile", {
          user: req.session.user,
          profile,
          error: "Name and email are required.",
          success: null
        });
      });
    }

    if (password && password !== confirmPassword) {
      return User.findById(userId, (err, results) => {
        const profile = (!err && results && results[0]) ? results[0] : {
          user_id: userId,
          name: req.session.user?.name || "",
          email: req.session.user?.email || "",
          role: req.session.user?.role || "customer",
          profile_image: req.session.user?.profileImage || null,
          phone,
          address
        };
        return res.render("profile", {
          user: req.session.user,
          profile,
          error: "Passwords do not match.",
          success: null
        });
      });
    }

    User.findByEmail(email, (eErr, rows) => {
      if (eErr) return res.status(500).send("Database error");
      const existing = rows && rows.find((r) => Number(r.user_id) !== Number(userId));
      if (existing) {
        return User.findById(userId, (err, results) => {
          const profile = (!err && results && results[0]) ? results[0] : {
            user_id: userId,
            name: req.session.user?.name || "",
            email: req.session.user?.email || "",
            role: req.session.user?.role || "customer",
            profile_image: req.session.user?.profileImage || null,
            phone,
            address
          };
          return res.render("profile", {
            user: req.session.user,
            profile,
            error: "Email is already in use.",
            success: null
          });
        });
      }

      User.updateProfile(
        userId,
        { name, email, password: password || null, profileImage, phone, address },
        (uErr) => {
          if (uErr) return res.status(500).send("Database error");

          req.session.user.name = name;
          req.session.user.email = email;
          if (typeof profileImage !== "undefined") {
            req.session.user.profileImage = profileImage || null;
          }
          res.locals.user = req.session.user;

          User.findById(userId, (rErr, results) => {
            const profile = (!rErr && results && results[0]) ? results[0] : {
              user_id: userId,
              name,
              email,
              role: req.session.user?.role || "customer",
              profile_image: req.session.user?.profileImage || null,
              phone,
              address
            };
            return res.render("profile", {
              user: req.session.user,
              profile,
              error: null,
              success: "Profile updated successfully."
            });
          });
        }
      );
    });
  }
};
