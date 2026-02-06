const express = require("express");
const http = require("http");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
require("dotenv").config();

const db = require("./config/db");

const app = express();
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { cors: { origin: "*" } });
app.set("io", io);

/* ======================
   MIDDLEWARE
====================== */
app.use(express.urlencoded({ extended: true }));
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ======================
   SESSION SETUP
====================== */
app.use(
  session({
    secret: process.env.SESSION_SECRET || "super_secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax"
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
   REFRESH LOYALTY POINTS FOR CUSTOMERS
====================== */
app.use((req, res, next) => {
  if (req.session.user && req.session.user.role === 'customer') {
    const User = require("./models/User");
    User.getLoyaltyPoints(req.session.user.id, (err, points) => {
      if (!err && points) {
        req.session.user.loyaltyPoints = points.current || 0;
        res.locals.user.loyaltyPoints = points.current || 0;
      }
      next();
    });
  } else {
    next();
  }
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
const walletController = require("./controllers/walletController");
const providerController = require("./controllers/providerController");
const loyaltyController = require("./controllers/loyaltyController");
const userController = require("./controllers/userController");
const helpController = require("./controllers/helpController");
const chatController = require("./controllers/chatController");
const Chat = require("./models/Chat");
const HelpMessage = require("./models/HelpMessage");

/* ======================
   ROUTES
====================== */

/* ---------- DB PATCHES ---------- */
const ensureProfileImageColumn = () => {
  db.query("SHOW COLUMNS FROM users LIKE 'profile_image'", (err, rows) => {
    if (err) {
      console.error("Profile image column check failed", err);
      return;
    }
    if (!rows || rows.length === 0) {
      db.query(
        "ALTER TABLE users ADD COLUMN profile_image VARCHAR(255) NULL AFTER email",
        (alterErr) => {
          if (alterErr) {
            console.error("Failed to add profile_image column", alterErr);
          } else {
            console.log("profile_image column added ✅");
          }
        }
      );
    }
  });
};

ensureProfileImageColumn();

const ensurePhoneColumn = () => {
  db.query("SHOW COLUMNS FROM users LIKE 'phone'", (err, rows) => {
    if (err) {
      console.error("Phone column check failed", err);
      return;
    }
    if (!rows || rows.length === 0) {
      db.query(
        "ALTER TABLE users ADD COLUMN phone VARCHAR(30) NULL AFTER email",
        (alterErr) => {
          if (alterErr) {
            console.error("Failed to add phone column", alterErr);
          } else {
            console.log("phone column added ✅");
          }
        }
      );
    }
  });
};

const ensureAddressColumn = () => {
  db.query("SHOW COLUMNS FROM users LIKE 'address'", (err, rows) => {
    if (err) {
      console.error("Address column check failed", err);
      return;
    }
    if (!rows || rows.length === 0) {
      db.query(
        "ALTER TABLE users ADD COLUMN address VARCHAR(255) NULL AFTER phone",
        (alterErr) => {
          if (alterErr) {
            console.error("Failed to add address column", alterErr);
          } else {
            console.log("address column added ✅");
          }
        }
      );
    }
  });
};

ensurePhoneColumn();
ensureAddressColumn();

const ensureHelpMessagesTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS help_messages (
      help_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      admin_id INT NULL,
      subject VARCHAR(120) NOT NULL,
      message TEXT NOT NULL,
      attachment_path VARCHAR(255) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
      admin_reply TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      responded_at TIMESTAMP NULL,
      KEY idx_help_user (user_id),
      KEY idx_help_status (status),
      KEY idx_help_created (created_at)
    )
  `;
  db.query(sql, (err) => {
    if (err) {
      console.error("Failed to create help_messages table", err);
    } else {
      console.log("help_messages table ready ✅");
    }
  });
};

ensureHelpMessagesTable();

const ensureHelpAttachmentColumn = () => {
  db.query("SHOW COLUMNS FROM help_messages LIKE 'attachment_path'", (err, rows) => {
    if (err) {
      console.error("Help attachment column check failed", err);
      return;
    }
    if (!rows || rows.length === 0) {
      db.query(
        "ALTER TABLE help_messages ADD COLUMN attachment_path VARCHAR(255) NULL AFTER message",
        (alterErr) => {
          if (alterErr) {
            console.error("Failed to add help attachment column", alterErr);
          } else {
            console.log("help_messages.attachment_path added ✅");
          }
        }
      );
    }
  });
};

ensureHelpAttachmentColumn();

const ensureHelpRepliesTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS help_message_replies (
      reply_id INT AUTO_INCREMENT PRIMARY KEY,
      help_id INT NOT NULL,
      sender_role VARCHAR(20) NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_help_reply_help (help_id),
      KEY idx_help_reply_created (created_at)
    )
  `;
  db.query(sql, (err) => {
    if (err) {
      console.error("Failed to create help_message_replies table", err);
    } else {
      console.log("help_message_replies table ready ✅");
    }
  });
};

ensureHelpRepliesTable();

const ensureChatTables = () => {
  const threadSql = `
    CREATE TABLE IF NOT EXISTS chat_threads (
      chat_id INT AUTO_INCREMENT PRIMARY KEY,
      booking_id INT NOT NULL UNIQUE,
      customer_id INT NOT NULL,
      provider_id INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_chat_customer (customer_id),
      KEY idx_chat_provider (provider_id)
    )
  `;

  const messageSql = `
    CREATE TABLE IF NOT EXISTS chat_messages (
      message_id INT AUTO_INCREMENT PRIMARY KEY,
      chat_id INT NOT NULL,
      sender_role VARCHAR(20) NOT NULL,
      sender_id INT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_chat_msg_chat (chat_id),
      KEY idx_chat_msg_created (created_at)
    )
  `;

  db.query(threadSql, (err) => {
    if (err) {
      console.error("Failed to create chat_threads table", err);
    } else {
      console.log("chat_threads table ready ✅");
    }
  });

  db.query(messageSql, (err) => {
    if (err) {
      console.error("Failed to create chat_messages table", err);
    } else {
      console.log("chat_messages table ready ✅");
    }
  });
};

ensureChatTables();

const ensureStorageImagesTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS storage_images (
      image_id INT AUTO_INCREMENT PRIMARY KEY,
      storage_id INT NOT NULL,
      image_path VARCHAR(255) NOT NULL,
      is_primary TINYINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_storage_images_storage (storage_id),
      KEY idx_storage_images_primary (is_primary)
    )
  `;
  db.query(sql, (err) => {
    if (err) {
      console.error("Failed to create storage_images table", err);
    } else {
      console.log("storage_images table ready ✅");
    }
  });
};

ensureStorageImagesTable();

io.on("connection", (socket) => {
  socket.on("chat:join", ({ chatId }) => {
    if (chatId) socket.join(`chat:${chatId}`);
  });

  socket.on("chat:send", ({ chatId, senderRole, senderId, message }) => {
    if (!chatId || !message) return;
    Chat.addMessage({ chatId, senderRole, senderId, message }, (err) => {
      if (err) return;
      io.to(`chat:${chatId}`).emit("chat:new", {
        chatId,
        sender_role: senderRole,
        sender_id: senderId,
        message,
        created_at: new Date().toISOString()
      });
    });
  });

  socket.on("help:join", ({ helpId }) => {
    if (helpId) socket.join(`help:${helpId}`);
  });

  socket.on("help:send", ({ helpId, senderRole, senderId, message }) => {
    if (!helpId || !message) return;
    HelpMessage.addReply({ helpId, senderRole, message }, (err) => {
      if (err) return;

      if (senderRole === "admin") {
        HelpMessage.reply({ id: helpId, adminId: senderId, reply: message, status: "ANSWERED" }, () => {});
      } else {
        HelpMessage.updateStatus({ id: helpId, status: "OPEN" }, () => {});
      }

      io.to(`help:${helpId}`).emit("help:new", {
        helpId,
        sender_role: senderRole,
        sender_id: senderId,
        message,
        created_at: new Date().toISOString()
      });
    });
  });
});

// Initialize wallet tables on startup
const WalletTransaction = require("./models/WalletTransaction");
WalletTransaction.initializeTables(() => {
  console.log("Wallet tables initialized ✅");
});

// HOME / LOGIN REDIRECT
app.get("/", (req, res) => {
  if (req.session.user) {
    if (req.session.user.role === "admin") return res.redirect("/admin/dashboard");
    if (req.session.user.role === "provider") return res.redirect("/provider/dashboard");
    return res.redirect("/customer/dashboard");
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

/* ---------- PROFILE ---------- */
const profileUploadDir = path.join(__dirname, "public", "uploads", "profile");
fs.mkdirSync(profileUploadDir, { recursive: true });

const profileUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, profileUploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      cb(null, `profile_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = [".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(file.originalname || "").toLowerCase());
    cb(ok ? null : new Error("Invalid file type"), ok);
  }
});

const helpUploadDir = path.join(__dirname, "public", "uploads", "help");
fs.mkdirSync(helpUploadDir, { recursive: true });

const helpUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, helpUploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      cb(null, `help_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".png", ".jpg", ".jpeg", ".webp", ".pdf"].includes(
      path.extname(file.originalname || "").toLowerCase()
    );
    cb(allowed ? null : new Error("Invalid file type"), allowed);
  }
});

const storageUploadDir = path.join(__dirname, "public", "uploads", "storage");
fs.mkdirSync(storageUploadDir, { recursive: true });

const storageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, storageUploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      cb(null, `storage_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    const allowed = [".png", ".jpg", ".jpeg", ".webp"].includes(
      path.extname(file.originalname || "").toLowerCase()
    );
    cb(allowed ? null : new Error("Invalid file type"), allowed);
  }
});

app.get("/profile", userController.showProfile);
app.post("/profile", profileUpload.single("profileImage"), userController.updateProfile);

/* ---------- HELP ---------- */
app.get("/help", helpController.showHelp);
app.post("/help", helpUpload.single("attachment"), helpController.submitHelp);
app.post("/help/:id/reply", helpController.userReply);

/* ---------- CHAT ---------- */
app.get("/chats", chatController.listChats);
app.get("/chat/:id", chatController.customerChat);
app.post("/chat/:id/send", chatController.customerSend);
app.get("/provider/chat/:id", chatController.providerChat);
app.post("/provider/chat/:id/send", chatController.providerSend);

/* ---------- CUSTOMER ---------- */
app.get("/customer/dashboard", customerController.dashboard);
app.get("/storage", storageController.browse);
app.get("/storage/:id", storageController.detail);
app.post("/storage/:id/review", storageController.addReview);
app.post("/storage/:id/complaint", storageController.addComplaint);

/* ---------- PROVIDER ---------- */
app.get("/provider/dashboard", providerController.dashboard);
app.get("/provider/kyc", providerController.showKycForm);
app.post("/provider/kyc", providerController.submitKyc);
app.get("/provider/storage", providerController.listStorage);
app.get("/provider/storage/add", providerController.showAddStorage);
app.post("/provider/storage/add", storageUpload.array("images", 6), providerController.addStorage);
app.get("/provider/storage/edit/:id", providerController.showEditStorage);
app.post("/provider/storage/edit/:id", storageUpload.array("images", 6), providerController.updateStorage);
app.get("/provider/storage/delete/:id", providerController.deleteStorage);
app.get("/provider/bookings", providerController.listBookings);
app.get("/provider/calendar", providerController.calendar);
app.get("/provider/promotions", providerController.promotions);
app.post("/provider/promotions", providerController.createPromotion);

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
app.post("/payment/paynow/finalize", invoiceController.payNowFinalize);
app.post("/api/paypal/create-order", invoiceController.paypalApiCreateOrder);
app.post("/api/paypal/capture-order", invoiceController.paypalApiCaptureOrder);
app.get("/stripe/success", invoiceController.stripeSuccess);
app.get("/stripe/cancel", invoiceController.stripeCancel);
app.get("/history", invoiceController.history);

/* ---------- WALLET ---------- */
app.get("/wallet", walletController.dashboard);
app.get("/wallet/topup", walletController.showTopupForm);
app.post("/wallet/topup", walletController.processTopup);
app.get("/wallet/history", walletController.history);
app.post("/api/wallet/paypal/create-order", walletController.paypalApiCreateTopupOrder);
app.post("/api/wallet/paypal/capture-order", walletController.paypalApiCaptureTopupOrder);
app.get("/wallet/stripe-success", walletController.stripeTopupSuccess);
app.get("/wallet/stripe-cancel", walletController.stripeTopupCancel);
app.post("/wallet/paynow/finalize", walletController.payNowTopupFinalize);
app.post("/wallet/netsqr/finalize", walletController.netsQrTopupFinalize);

/* ---------- LOYALTY POINTS ---------- */
app.get("/loyalty/dashboard", loyaltyController.dashboard);
app.get("/loyalty/redeem", loyaltyController.showRedeemPage);
app.post("/api/loyalty/redeem", loyaltyController.redeemPointsApi);
app.get("/api/loyalty/info", loyaltyController.getInfoApi);
app.post("/api/loyalty/calculate-reward", loyaltyController.calculateReward);

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
app.get("/admin/notifications", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }

  adminController.notifications(req, res);
});
app.get("/admin/leaderboards", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }

  adminController.leaderboards(req, res);
});

app.get("/admin/moderation", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }

  adminController.moderationQueue(req, res);
});

app.get("/admin/help", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }
  helpController.adminInbox(req, res);
});
app.post("/admin/help/:id/reply", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }
  helpController.adminReply(req, res);
});

/* ---------- ADMIN KYC ---------- */
app.get("/admin/kyc", (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }
  return adminController.showKycList(req, res);
});
app.post("/admin/kyc/:id/approve", (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }
  return adminController.approveKyc(req, res);
});
app.post("/admin/kyc/:id/reject", (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("Not authorized");
  }
  return adminController.rejectKyc(req, res);
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
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
