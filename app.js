const express = require("express");
const session = require("express-session");
const path = require("path");
require("dotenv").config();

const app = express();

/* ======================
   MIDDLEWARE
====================== */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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
   VIEW ENGINE
====================== */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

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
app.get("/customer/dashboard", customerController.dashboard);
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
app.get("/payment/success", invoiceController.paymentSuccess);
app.get("/payment/retry/:invoiceId", invoiceController.paymentRetry);
app.post("/api/paypal/create-order", invoiceController.paypalApiCreateOrder);
app.post("/api/paypal/capture-order", invoiceController.paypalApiCaptureOrder);
app.get("/stripe/success", invoiceController.stripeSuccess);
app.get("/stripe/cancel", invoiceController.stripeCancel);
app.get("/history", invoiceController.history);

/* ---------- NETS QR ---------- */
app.get("/sse/payment-status/:txnRetrievalRef", invoiceController.netsSsePaymentStatus);
app.post("/generateNETSQR", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const netsQrService = require("./services/nets");
  return netsQrService.generateQrCode(req, res);
});
app.get("/nets-qr/success", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const Invoice = require("./models/Invoice");
  const txnRetrievalRef = (req.query.txn_retrieval_ref || "").trim();

  if (!txnRetrievalRef) {
    return res.render("netsTxnSuccessStatus", {
      message: "Transaction Successful!",
      invoiceId: null,
      paymentMethod: null
    });
  }

  Invoice.findByProviderRef("NETSQR", txnRetrievalRef, (err, row) => {
    if (err || !row || row.user_id !== req.session.user.id) {
      return res.render("netsTxnSuccessStatus", {
        message: "Transaction Successful!",
        invoiceId: null,
        paymentMethod: null
      });
    }

    return res.render("netsTxnSuccessStatus", {
      message: "Transaction Successful!",
      invoiceId: row.id,
      paymentMethod: row.payment_method || null
    });
  });
});
app.get("/nets-qr/fail", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  return res.render("netsTxnFailStatus", { message: "Transaction Failed. Please try again." });
});
app.get("/shopping", (req, res) => res.redirect("/storage"));
app.get("/netsqr/fail/:invoiceId", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  return invoiceController.netsQrFailPage(req, res);
});
app.get("/netsqr/pay/:invoiceId", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  return invoiceController.netsQrPayPage(req, res);
});
app.get("/netsqr/status/:invoiceId", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  return invoiceController.netsQrStatus(req, res);
});
app.post("/netsqr/webhook", express.json({ type: "*/*" }), (req, res) =>
  invoiceController.netsQrWebhook(req, res)
);
app.post("/netsqr/finalize", (req, res) => invoiceController.netsQrFinalize(req, res));
app.get("/invoice/:id", (req, res) => invoiceController.viewInvoice(req, res));

/* ---------- ADMIN DASHBOARD ---------- */
app.get("/admin/dashboard", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }

  adminController.dashboard(req, res);
});
app.get("/admin/reports", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }

  adminController.reports(req, res);
});

/* ---------- ADMIN USERS ---------- */
app.get("/admin/users", adminController.showUserList);
app.get("/admin/users/edit/:id", adminController.showEditUserForm);
app.post("/admin/users/edit/:id", adminController.updateUser);
app.get("/admin/users/delete/:id", adminController.deleteUser);

/* ---------- ADMIN BOOKINGS ---------- */
app.get("/admin/bookings", (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }
  adminController.showBookingList(req, res);
});
app.get("/admin/bookings/edit/:id", (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }
  adminController.showEditBookingForm(req, res);
});
app.post("/admin/bookings/edit/:id", (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }
  adminController.updateBooking(req, res);
});
app.get("/admin/bookings/delete/:id", (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }
  adminController.deleteBooking(req, res);
});
app.post("/admin/payments/:id/refund", (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }
  invoiceController.adminRefund(req, res);
});

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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
