const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");
const Invoice = require("../models/Invoice");

function requireCustomer(req, res) {
  if (!req.session.user) return true;
  if (req.session.user.role !== "customer") {
    res.status(403).send("Not authorized");
    return true;
  }
  return false;
}

module.exports = {
  /**
   * GET /wallet - View wallet dashboard
   */
  dashboard: (req, res) => {
    if (requireCustomer(req, res)) return;

    const userId = req.session.user.id;
    User.getWalletBalance(userId, (errBalance, balance) => {
      if (errBalance) {
        return res.status(500).render("error", { message: "Could not load wallet balance" });
      }

      WalletTransaction.getByUser(userId, (errTx, transactions) => {
        if (errTx) transactions = [];

        res.render("wallet_dashboard", {
          user: req.session.user,
          balance: Number(balance) || 0,
          transactions: transactions || []
        });
      });
    });
  },

  /**
   * GET /wallet/topup - Show top-up form with same payment methods as checkout
   */
  showTopupForm: (req, res) => {
    if (requireCustomer(req, res)) return;

    const userId = req.session.user.id;
    User.getWalletBalance(userId, (err, balance) => {
      res.render("wallet_topup", {
        user: req.session.user,
        balance: Number(balance) || 0,
        selectedMethod: req.session.paymentMethod || "",
        paypalClientId: process.env.PAYPAL_CLIENT_ID || ""
      });
    });
  },

  /**
   * POST /wallet/topup - Process wallet top-up with payment method
   */
  processTopup: (req, res) => {
    if (requireCustomer(req, res)) return;

    const userId = req.session.user.id;
    const { amount, paymentMethod: method } = req.body;

    const topupAmount = parseFloat(amount);
    if (Number.isNaN(topupAmount) || topupAmount <= 0 || topupAmount > 100000) {
      return res.status(400).send("Invalid top-up amount");
    }

    const allowed = ["Stripe", "PayPal", "NETSQR", "PayNow", "EWallet"];
    if (!allowed.includes(method)) {
      return res.status(400).send("Invalid payment method");
    }

    // E-Wallet payment (use another wallet? Not typical, skip)
    if (method === "EWallet") {
      return res.status(400).send("Cannot use E-Wallet to top-up E-Wallet");
    }

    // Store pending wallet top-up in session
    req.session.pendingWalletTopup = {
      amount: topupAmount,
      method: method,
      txnRetrievalRef: null,
      stripeSessionId: null
    };

    // Handle PayPal
    if (method === "PayPal") {
      return res.render("paypal_topup", {
        user: req.session.user,
        amount: topupAmount,
        paypalClientId: process.env.PAYPAL_CLIENT_ID || ""
      });
    }

    // Handle Stripe
    if (method === "Stripe") {
      (async () => {
        try {
          const stripe = require("../services/stripe");
          const session = await stripe.createCheckoutSession({
            amount: topupAmount,
            reference: `WALLET-TOPUP-${Date.now()}`,
            userId,
            successUrl: `${process.env.APP_BASE_URL || 'http://localhost:3000'}/wallet/stripe-success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${process.env.APP_BASE_URL || 'http://localhost:3000'}/wallet/stripe-cancel`
          });

          if (!session || !session.id || !session.url) {
            return res.status(400).send("Stripe did not return a valid checkout session");
          }

          req.session.pendingWalletTopup.stripeSessionId = session.id;
          return res.redirect(session.url);
        } catch (e) {
          console.error("Stripe init error:", e);
          return res.status(400).send(e.message || "Could not start Stripe payment");
        }
      })();
      return;
    }

    // Handle NETS QR
    if (method === "NETSQR") {
      try {
        const nets = require("../services/nets");
        req.body.cartTotal = topupAmount.toFixed(2);
        req.body.topupAmount = topupAmount;
        req.body.isWalletTopup = true;  // Flag for wallet top-up
        return nets.generateQrCode(req, res);
      } catch (e) {
        console.error("NETS QR init error:", e);
        return res.status(400).send(e.message || "Could not start NETS QR payment");
      }
    }

    // Handle PayNow
    if (method === "PayNow") {
      return res.render("paynow_topup", {
        user: req.session.user,
        amount: topupAmount
      });
    }
  },

  /**
   * POST /api/wallet/paypal/create-order
   */
  paypalApiCreateTopupOrder: (req, res) => {
    const user = req.session.user;
    const pending = req.session.pendingWalletTopup;
    if (!user) return res.status(401).json({ error: "Not logged in" });
    if (!pending || pending.method !== "PayPal") {
      return res.status(400).json({ error: "No pending PayPal wallet top-up" });
    }

    (async () => {
      try {
        const paypal = require("../services/paypal");
        const amount = pending.amount.toFixed(2);
        const order = await paypal.createOrder({ amount, referenceId: `WALLET-${Date.now()}` });
        if (!order || !order.id) return res.status(500).json({ error: "No order id returned by PayPal" });
        return res.json({ id: order.id });
      } catch (e) {
        console.error("PayPal create-order error:", e);
        return res.status(500).json({ error: e.message || "Failed to create PayPal order" });
      }
    })();
  },

  /**
   * POST /api/wallet/paypal/capture-order
   */
  paypalApiCaptureTopupOrder: (req, res) => {
    const user = req.session.user;
    const pending = req.session.pendingWalletTopup;
    const orderId = req.body.orderId || req.body.orderID;
    if (!user) return res.status(401).json({ error: "Not logged in" });
    if (!pending || pending.method !== "PayPal") {
      return res.status(400).json({ error: "No pending PayPal wallet top-up" });
    }
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    (async () => {
      try {
        const paypal = require("../services/paypal");
        const capture = await paypal.captureOrder(orderId);

        if (!capture || capture.status !== "COMPLETED") {
          return res.status(400).json({ error: "PayPal payment was not completed" });
        }

        const amount = pending.amount || 0;
        const capturedValue = Number(
          capture?.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ||
          capture?.purchase_units?.[0]?.amount?.value ||
          0
        );

        if (Math.abs(capturedValue - amount) > 0.01) {
          return res.status(400).json({ error: "Captured amount mismatch" });
        }

        const description = `Wallet Top-up via PayPal SGD $${amount.toFixed(2)}`;
        WalletTransaction.topup(user.id, amount, description, (err) => {
          if (err) return res.status(400).json({ error: err.message || "Top-up failed" });
          User.getWalletBalance(user.id, (errBalance, balance) => {
            if (!errBalance) {
              req.session.user.walletBalance = balance;
              req.session.user.wallet_balance = balance;
            }
            delete req.session.pendingWalletTopup;
            return res.json({ ok: true, redirect: `/wallet?message=Top-up+successful+SGD+$${amount.toFixed(2)}` });
          });
        });
      } catch (e) {
        console.error("PayPal capture-order error:", e);
        return res.status(500).json({ error: e.message || "Failed to capture PayPal order" });
      }
    })();
  },

  /**
   * GET /wallet/stripe-success?session_id=...
   */
  stripeTopupSuccess: (req, res) => {
    const user = req.session.user;
    const pending = req.session.pendingWalletTopup;
    const sessionId = req.query.session_id;
    if (!user) return res.redirect("/login");
    if (!pending || pending.method !== "Stripe") return res.redirect("/wallet");
    if (!sessionId) return res.redirect("/wallet");
    if (pending.stripeSessionId && pending.stripeSessionId !== sessionId) {
      return res.redirect("/wallet");
    }

    (async () => {
      try {
        const stripe = require("../services/stripe");
        const session = await stripe.retrieveCheckoutSession(sessionId);
        if (!session || session.payment_status !== "paid") {
          return res.redirect("/wallet");
        }

        const amount = pending.amount || 0;
        const expectedCents = Math.round(amount * 100);
        if (session.amount_total && session.amount_total !== expectedCents) {
          return res.redirect("/wallet");
        }

        const description = `Wallet Top-up via Stripe SGD $${amount.toFixed(2)}`;
        
        // Use a promise wrapper for the callback-based function
        return new Promise((resolve, reject) => {
          WalletTransaction.topup(user.id, amount, description, (err) => {
            if (err) {
              console.error("Wallet topup error:", err);
              return resolve(res.redirect("/wallet?error=Top-up+failed"));
            }
            
            User.getWalletBalance(user.id, (errBalance, balance) => {
              if (errBalance) {
                console.error("Get balance error:", errBalance);
                return resolve(res.redirect("/wallet?error=Balance+update+failed"));
              }
              
              req.session.user.walletBalance = balance;
              req.session.user.wallet_balance = balance;
              delete req.session.pendingWalletTopup;
              req.session.save((saveErr) => {
                if (saveErr) console.error("Session save error:", saveErr);
                return resolve(res.redirect(`/wallet?message=Top-up+successful+SGD+$${amount.toFixed(2)}`));
              });
            });
          });
        });
      } catch (e) {
        console.error("Stripe success error:", e);
        return res.redirect("/wallet");
      }
    })();
  },

  /**
   * GET /wallet/stripe-cancel
   */
  stripeTopupCancel: (req, res) => {
    const pending = req.session.pendingWalletTopup;
    if (pending && pending.method === "Stripe") {
      delete req.session.pendingWalletTopup;
    }
    return res.redirect("/wallet/topup");
  },

  /**
   * POST /wallet/paynow/finalize - Complete PayNow wallet top-up
   */
  payNowTopupFinalize: (req, res) => {
    const user = req.session.user;
    const pending = req.session.pendingWalletTopup;
    if (!user) return res.status(401).json({ ok: false, error: "Not logged in" });
    if (!pending || pending.method !== "PayNow") {
      return res.status(400).json({ ok: false, error: "No pending PayNow wallet top-up" });
    }

    const amount = pending.amount || 0;
    const description = `Wallet Top-up via PayNow SGD $${amount.toFixed(2)}`;
    WalletTransaction.topup(user.id, amount, description, (err) => {
      if (err) return res.status(400).json({ ok: false, error: err.message || "Top-up failed" });
      User.getWalletBalance(user.id, (errBalance, balance) => {
        if (!errBalance) {
          req.session.user.walletBalance = balance;
          req.session.user.wallet_balance = balance;
        }
        delete req.session.pendingWalletTopup;
        return res.json({ ok: true, redirect: `/wallet?message=Top-up+successful+SGD+$${amount.toFixed(2)}` });
      });
    });
  },

  /**
   * POST /wallet/netsqr/finalize - Complete NETSQR wallet top-up
   */
  netsQrTopupFinalize: (req, res) => {
    const user = req.session.user;
    const pending = req.session.pendingWalletTopup;
    if (!user) return res.status(401).json({ ok: false, error: "Not logged in" });
    if (!pending || pending.method !== "NETSQR") {
      return res.status(400).json({ ok: false, error: "No pending NETS wallet top-up" });
    }

    const amount = pending.amount || 0;
    const description = `Wallet Top-up via NETS QR SGD $${amount.toFixed(2)}`;
    WalletTransaction.topup(user.id, amount, description, (err) => {
      if (err) return res.status(400).json({ ok: false, error: err.message || "Top-up failed" });
      User.getWalletBalance(user.id, (errBalance, balance) => {
        if (!errBalance) {
          req.session.user.walletBalance = balance;
          req.session.user.wallet_balance = balance;
        }
        delete req.session.pendingWalletTopup;
        return res.json({ ok: true });
      });
    });
  },

  /**
   * GET /wallet/history - View transaction history
   */
  history: (req, res) => {
    if (requireCustomer(req, res)) return;

    const userId = req.session.user.id;
    User.getWalletBalance(userId, (errBalance, balance) => {
      WalletTransaction.getByUser(userId, (errTx, transactions) => {
        if (errTx) transactions = [];

        const formattedTransactions = (transactions || []).map((tx) => ({
          ...tx,
          amount_display: Math.abs(Number(tx.amount) || 0).toFixed(2),
          type_display: tx.type === "topup" ? "Top-up" : tx.type === "purchase" ? "Purchase" : "Refund",
          sign: tx.type === "purchase" ? "-" : "+",
          created_at_display: new Date(tx.created_at).toLocaleDateString("en-SG")
        }));

        res.render("wallet_history", {
          user: req.session.user,
          balance: Number(balance) || 0,
          transactions: formattedTransactions
        });
      });
    });
  }
};
