const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();

/* ======================
   MIDDLEWARE
====================== */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ======================
   SESSION SETUP
====================== */
app.use(
    session({
        secret: "super_secret_key",
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: app.get("env") === "production",
            httpOnly: true
        }
    })
);

/* ======================
   EXPOSE SESSION USER TO EJS
====================== */
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

/* ======================
   VIEW ENGINE & STATIC FILES
====================== */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ✅ THIS MAKES styles.css WORK
app.use(express.static(path.join(__dirname, "public")));

/* ======================
   CONTROLLERS
====================== */
const authController = require("./controllers/authController");
const adminController = require("./controllers/adminController");

const storageController = require("./controllers/storageController");
const customerController = require("./controllers/customerController");
const cartController = require("./controllers/cartController");
const invoiceController = require("./controllers/invoiceController");

/* ======================
   ROUTES
====================== */

// HOME / LOGIN REDIRECT
app.get("/", (req, res) => {
    if (req.session.user) {
        return req.session.user.role === "admin"
            ? res.redirect("/admin/dashboard")
            : res.redirect("/customer/dashboard");
    }
    res.render("login");
});

/* ---------- AUTH ---------- */
app.get("/login", authController.showLogin);
app.post("/login", authController.login);

app.get("/register", authController.showRegister);
app.post("/register", authController.register);

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/login");
    });
});

/* ---------- CUSTOMER ---------- */
app.get("/customer/dashboard", adminController.dashboard);
app.get("/storage", storageController.browse);

/* ---------- CART ---------- */
app.get("/cart", cartController.viewCart);
app.post("/cart/add", cartController.add);
app.post("/cart/update", cartController.update);
app.post("/cart/remove", cartController.remove);

/* ---------- CHECKOUT / PAYMENT ---------- */
app.post("/checkout", invoiceController.checkout);
app.get("/payment", invoiceController.paymentForm);
app.post("/payment", invoiceController.processPayment);
app.get("/history", invoiceController.history);

/* ---------- ADMIN DASHBOARD ---------- */
app.get("/admin/dashboard", (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "admin") {
        return res.status(403).send("Not authorized");
    }

    // 🔥 This is where analytics + storage list render
    adminController.showStorageList(req, res);
});

/* ---------- ADMIN USERS ---------- */
app.get("/admin/users", adminController.showUserList);
app.get("/admin/users/edit/:id", adminController.showEditUserForm);
app.post("/admin/users/edit/:id", adminController.updateUser);
app.get("/admin/users/delete/:id", adminController.deleteUser);

/* ---------- ADMIN STORAGE ---------- */
app.get("/admin/storage/add", adminController.showAddForm);
app.post("/admin/storage/add", adminController.addStorage);

app.get("/admin/storage/edit/:id", adminController.showEditForm);
app.post("/admin/storage/edit/:id", adminController.updateStorage);

app.get("/admin/storage/delete/:id", adminController.deleteStorage);
app.get("/admin/storage", adminController.showStorageList);

/* ======================
   SERVER
====================== */
const PORT = 3000;
app.listen(PORT, () =>
    console.log(`🚀 Server running at http://localhost:${PORT}`)
);
