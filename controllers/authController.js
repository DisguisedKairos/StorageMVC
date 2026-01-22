const crypto = require("crypto");
const User = require("../models/User");

module.exports = {
    showLogin(req, res) {
        res.render("login");
    },

    login(req, res) {
        const { email, password } = req.body;

        User.findByEmail(email, (err, results) => {
            if (err) throw err;

            if (results.length === 0) {
                return res.send("Invalid email or password");
            }

            const user = results[0];
            const pwHash = crypto.createHash("sha1").update(password).digest("hex");

            if (user.password_hash !== pwHash) {
                return res.send("Invalid email or password");
            }

            // Save user in session
            req.session.user = {
                id: user.user_id,
                name: user.name,
                email: user.email,
                role: user.role
            };

            if (user.role === "admin") {
                res.redirect("/admin/dashboard");
            } else {
                res.redirect("/customer/dashboard");
            }
        });
    },

    showRegister(req, res) {
        res.render("register");
    },

    register(req, res) {
        User.createUser(req.body, (err) => {
            if (err) throw err;
            res.redirect("/login");
        });
    }
};
