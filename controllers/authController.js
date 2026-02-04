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
                user_id: user.user_id,
                name: user.name,
                email: user.email,
                role: user.role,
                walletBalance: 0
            };

            // Load wallet balance only for customers, then redirect by role
            const redirectByRole = () => {
                if (user.role === "admin") return res.redirect("/admin/dashboard");
                if (user.role === "provider") return res.redirect("/provider/dashboard");
                return res.redirect("/customer/dashboard");
            };

            if (user.role === "customer") {
                User.getWalletBalance(user.user_id, (errBalance, balance) => {
                    // Even if balance lookup fails, don't block login
                    req.session.user.walletBalance = (balance || 0);
                    req.session.user.wallet_balance = (balance || 0);
                    return redirectByRole();
                });
            } else {
                return redirectByRole();
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
