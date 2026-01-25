const Cart = require("../models/Cart");
const Invoice = require("../models/Invoice");

function parseDateOnly(str) {
  const d = new Date(`${str}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetweenInclusive(startStr, endStr) {
  const s = parseDateOnly(startStr);
  const e = parseDateOnly(endStr);
  if (!s || !e) return null;
  const ms = e.getTime() - s.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
  return days;
}

function computeCartTotals(userId, startDate, endDate, callback) {
  const days = daysBetweenInclusive(startDate, endDate);
  if (!days || days <= 0) {
    return callback(new Error("Invalid start/end date"));
  }

  Cart.getItemsByUser(userId, (err, items) => {
    if (err) return callback(err);
    if (!items || items.length === 0) return callback(new Error("Cart is empty"));

    const lineItems = items.map((it) => {
      const qty = parseInt(it.quantity, 10) || 0;
      const unit = Number(it.unit_price) || 0;
      const subtotal = unit * qty * days;
      return { ...it, quantity: qty, unit_price: unit, subtotal, days };
    });

    const subtotal = lineItems.reduce((sum, it) => sum + it.subtotal, 0);
    const tax = 0;
    const totalAmount = subtotal + tax;
    const totalPerDay = lineItems.reduce((sum, it) => sum + it.unit_price * it.quantity, 0);

    return callback(null, {
      days,
      items: lineItems,
      subtotal,
      tax,
      totalAmount,
      totalPerDay,
    });
  });
}

function requireCustomer(req, res) {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "customer") return res.status(403).send("Not authorized");
}

module.exports = {
  // POST /checkout -> redirect to payment page
  checkout: (req, res) => {
    const guard = requireCustomer(req, res);
    if (guard) return;
    return res.redirect("/payment");
  },

  // GET /payment -> show payment form + cart summary
  paymentForm: (req, res) => {
    const guard = requireCustomer(req, res);
    if (guard) return;

    const userId = req.session.user.id;
    Cart.getItemsByUser(userId, (err, items) => {
      if (err) return res.status(500).send("Database error");
      if (!items || items.length === 0) return res.redirect("/cart");

      const totalPerDay = items.reduce((sum, i) => sum + Number(i.unit_price) * Number(i.quantity), 0);

      // default dates: today -> today + 6 days
      const today = new Date();
      const fmt = (d) => d.toISOString().slice(0, 10);
      const startDate = fmt(today);
      const endDate = fmt(new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000));

      res.render("payment", {
        user: req.session.user,
        items,
        totalPerDay,
        startDate,
        endDate
      });
    });
  },

  // POST /payment -> create bookings + payments, clear cart, render invoice
  processPayment: (req, res) => {
    const guard = requireCustomer(req, res);
    if (guard) return;

    const userId = req.session.user.id;
    const { start_date, end_date, method } = req.body;

    const paymentMethod = (method || "").trim();
    const allowed = ["PayNow", "Cash", "PayPal", "NETSQR", "Stripe"];
    if (!allowed.includes(paymentMethod)) {
      return res.status(400).send("Invalid payment method");
    }

    if (paymentMethod === "PayPal" || paymentMethod === "NETSQR" || paymentMethod === "Stripe") {
      // Store pending payment info in session until provider confirms payment
      req.session.pendingPayment = {
        method: paymentMethod,
        start_date,
        end_date,
        txnRetrievalRef: null,
        stripeSessionId: null
      };

      return computeCartTotals(userId, start_date, end_date, async (err, summary) => {
        if (err) return res.status(400).send(err.message || "Checkout failed");

        if (paymentMethod === "PayPal") {
          return res.render("paypal_checkout", {
            user: req.session.user,
            totalAmount: Number(summary.totalAmount) || 0,
            paypalClientId: process.env.PAYPAL_CLIENT_ID || ""
          });
        }

        if (paymentMethod === "Stripe") {
          try {
            const stripe = require("../services/stripe");
            const amount = Number(summary.totalAmount) || 0;
            const session = await stripe.createCheckoutSession({
              amount,
              reference: `STORAGE-${Date.now()}`,
              userId
            });

            if (!session || !session.id || !session.url) {
              return res.status(400).send("Stripe did not return a valid checkout session");
            }

            req.session.pendingPayment.stripeSessionId = session.id;
            return res.redirect(session.url);
          } catch (e) {
            console.error("Stripe init error:", e);
            return res.status(400).send(e.message || "Could not start Stripe payment");
          }
        }

        try {
          const nets = require("../services/nets");
          const amount = Number(summary.totalAmount) || 0;
          req.body.cartTotal = amount.toFixed(2);
          return nets.generateQrCode(req, res);
        } catch (e) {
          console.error("NETS QR init error:", e);
          return res.status(400).send(e.message || "Could not start NETS QR payment");
        }
      });
    }

    Invoice.createFromCart(userId, start_date, end_date, paymentMethod, (err, data) => {
      if (err) {
        // keep it simple to match your current UI (no flash)
        return res.status(400).send(err.message || "Checkout failed");
      }

      // ensure numbers for toFixed in EJS
      data.header.subtotal = Number(data.header.subtotal) || 0;
      data.header.tax = Number(data.header.tax) || 0;
      data.header.totalAmount = Number(data.header.totalAmount) || 0;
      data.items = (data.items || []).map((it) => ({
        ...it,
        unit_price: Number(it.unit_price) || 0,
        subtotal: Number(it.subtotal) || 0,
        quantity: parseInt(it.quantity, 10) || 0,
        days: parseInt(it.days, 10) || 0
      }));

      res.render("invoice", {
        user: req.session.user,
        header: data.header,
        items: data.items
      });
    });
  },

  // GET /payment/success -> render invoice from session
  paymentSuccess: (req, res) => {
    const guard = requireCustomer(req, res);
    if (guard) return;

    const data = req.session.lastInvoice;
    if (!data || !data.header) {
      return res.redirect("/cart");
    }

    // one-time render
    delete req.session.lastInvoice;
    return res.render("invoice", {
      user: req.session.user,
      header: data.header,
      items: data.items
    });
  },

  // GET /payment/retry/:invoiceId -> reset pending invoice
  paymentRetry: (req, res) => {
    const user = req.session.user;
    const invoiceId = parseInt(req.params.invoiceId, 10);
    if (!user) return res.redirect("/login");
    if (Number.isNaN(invoiceId)) return res.redirect("/payment");

    Invoice.resetPendingPayment({ invoiceId, userId: user.id }, () => {
      if (req.session.netsqr && req.session.netsqr[invoiceId]) {
        delete req.session.netsqr[invoiceId];
      }
      return res.redirect("/payment");
    });
  },

  /**
   * PayPal JS SDK endpoints
   * POST /api/paypal/create-order
   * POST /api/paypal/capture-order
   */
  paypalApiCreateOrder: (req, res) => {
    const user = req.session.user;
    const pending = req.session.pendingPayment;
    if (!user) return res.status(401).json({ error: "Not logged in" });
    if (!pending || pending.method !== "PayPal") {
      return res.status(400).json({ error: "No pending PayPal payment" });
    }

    computeCartTotals(user.id, pending.start_date, pending.end_date, async (err, summary) => {
      if (err) return res.status(400).json({ error: err.message || "Checkout failed" });
      try {
        const paypal = require("../services/paypal");
        const amount = (Number(summary.totalAmount) || 0).toFixed(2);
        const order = await paypal.createOrder({ amount, referenceId: `STORAGE-${Date.now()}` });
        if (!order || !order.id) return res.status(500).json({ error: "No order id returned by PayPal" });
        return res.json({ id: order.id });
      } catch (e) {
        console.error("PayPal create-order error:", e);
        return res.status(500).json({ error: e.message || "Failed to create PayPal order" });
      }
    });
  },

  paypalApiCaptureOrder: (req, res) => {
    const user = req.session.user;
    const pending = req.session.pendingPayment;
    const orderId = req.body.orderId || req.body.orderID;
    if (!user) return res.status(401).json({ error: "Not logged in" });
    if (!pending || pending.method !== "PayPal") {
      return res.status(400).json({ error: "No pending PayPal payment" });
    }
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    (async () => {
      try {
        const paypal = require("../services/paypal");
        const capture = await paypal.captureOrder(orderId);

        if (!capture || capture.status !== "COMPLETED") {
          return res.status(400).json({ error: "PayPal payment was not completed" });
        }

        return Invoice.createFromCart(
          user.id,
          pending.start_date,
          pending.end_date,
          "PayPal",
          (err, data) => {
            if (err) return res.status(400).json({ error: err.message || "Checkout failed" });
            data.header.subtotal = Number(data.header.subtotal) || 0;
            data.header.tax = Number(data.header.tax) || 0;
            data.header.totalAmount = Number(data.header.totalAmount) || 0;
            data.items = (data.items || []).map((it) => ({
              ...it,
              unit_price: Number(it.unit_price) || 0,
              subtotal: Number(it.subtotal) || 0,
              quantity: parseInt(it.quantity, 10) || 0,
              days: parseInt(it.days, 10) || 0
            }));

            req.session.lastInvoice = data;
            delete req.session.pendingPayment;
            return res.json({ ok: true, redirect: "/payment/success" });
          }
        );
      } catch (e) {
        console.error("PayPal capture-order error:", e);
        return res.status(500).json({ error: e.message || "Failed to capture PayPal order" });
      }
    })();
  },

  /**
   * Stripe redirect endpoints
   * GET /stripe/success?session_id=...
   * GET /stripe/cancel
   */
  stripeSuccess: (req, res) => {
    const user = req.session.user;
    const pending = req.session.pendingPayment;
    const sessionId = req.query.session_id;
    if (!user) return res.redirect("/login");
    if (!pending || pending.method !== "Stripe") return res.redirect("/payment");
    if (!sessionId) return res.redirect("/payment");
    if (pending.stripeSessionId && pending.stripeSessionId !== sessionId) {
      return res.redirect("/payment");
    }

    (async () => {
      try {
        const stripe = require("../services/stripe");
        const session = await stripe.retrieveCheckoutSession(sessionId);
        if (!session || session.payment_status !== "paid") {
          return res.redirect("/payment");
        }

        return Invoice.createFromCart(
          user.id,
          pending.start_date,
          pending.end_date,
          "Stripe",
          (err, data) => {
            if (err) return res.status(400).send(err.message || "Checkout failed");
            data.header.subtotal = Number(data.header.subtotal) || 0;
            data.header.tax = Number(data.header.tax) || 0;
            data.header.totalAmount = Number(data.header.totalAmount) || 0;
            data.items = (data.items || []).map((it) => ({
              ...it,
              unit_price: Number(it.unit_price) || 0,
              subtotal: Number(it.subtotal) || 0,
              quantity: parseInt(it.quantity, 10) || 0,
              days: parseInt(it.days, 10) || 0
            }));

            req.session.lastInvoice = data;
            delete req.session.pendingPayment;
            return res.redirect("/payment/success");
          }
        );
      } catch (e) {
        console.error("Stripe success error:", e);
        return res.redirect("/payment");
      }
    })();
  },

  stripeCancel: (req, res) => {
    const pending = req.session.pendingPayment;
    if (pending && pending.method === "Stripe") {
      delete req.session.pendingPayment;
    }
    return res.redirect("/payment");
  },

  /**
   * NETS QR SSE status endpoint
   * GET /sse/payment-status/:txnRetrievalRef
   */
  netsSsePaymentStatus: (req, res) => {
    const txnRetrievalRef = req.params.txnRetrievalRef;
    const pending = req.session.pendingPayment;
    if (!txnRetrievalRef) return res.status(400).end();

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const startedAt = Date.now();
    const MAX_MS = 5 * 60 * 1000;
    let interval = null;
    let closed = false;
    let finalized = false;

    const send = (obj) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (interval) clearInterval(interval);
      try { res.end(); } catch (_) {}
    };

    req.on("close", cleanup);

    const pollOnce = async () => {
      try {
        const elapsed = Date.now() - startedAt;
        if (elapsed > MAX_MS) {
          send({ fail: true, reason: "timeout" });
          return cleanup();
        }

        const axios = require("axios");
        const response = await axios.post(
          "https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/query",
          { txn_retrieval_ref: txnRetrievalRef, frontend_timeout_status: 0 },
          {
            headers: {
              "api-key": process.env.API_KEY || process.env.NETS_API_KEY,
              "project-id": process.env.PROJECT_ID || process.env.NETS_PROJECT_ID,
              "Content-Type": "application/json"
            }
          }
        );

        res.write(`data: ${JSON.stringify(response.data)}\n\n`);

        const resData = response.data?.result?.data || {};
        if (resData.response_code !== "00" || resData.txn_status !== 1) {
          send({ pending: true, responseCode: resData.response_code || "", txnStatus: resData.txn_status || 0 });
          return;
        }

        if (finalized) return;
        finalized = true;

        if (!pending || pending.method !== "NETSQR") {
          send({ success: true });
          return cleanup();
        }

        Invoice.createFromCart(
          req.session.user.id,
          pending.start_date,
          pending.end_date,
          "NETSQR",
          (err, data) => {
            if (err) {
              send({ fail: true, reason: err.message || "checkout_failed" });
              return cleanup();
            }

            data.header.subtotal = Number(data.header.subtotal) || 0;
            data.header.tax = Number(data.header.tax) || 0;
            data.header.totalAmount = Number(data.header.totalAmount) || 0;
            data.items = (data.items || []).map((it) => ({
              ...it,
              unit_price: Number(it.unit_price) || 0,
              subtotal: Number(it.subtotal) || 0,
              quantity: parseInt(it.quantity, 10) || 0,
              days: parseInt(it.days, 10) || 0
            }));

            req.session.lastInvoice = data;
            delete req.session.pendingPayment;
            send({ success: true });
            return cleanup();
          }
        );
      } catch (e) {
        send({ pending: true, error: e.message || "query_failed" });
      }
    };

    pollOnce();
    interval = setInterval(pollOnce, 5000);
  },

  // GET /netsqr/fail/:invoiceId
  netsQrFailPage: (req, res) => {
    const invoiceId = parseInt(req.params.invoiceId, 10);
    if (Number.isNaN(invoiceId)) return res.redirect("/payment");
    return res.render("netsTxnFailStatus", {
      user: req.session.user,
      invoiceId,
      message: "Transaction failed or timed out."
    });
  },

  // GET /netsqr/pay/:invoiceId
  netsQrPayPage: (req, res) => {
    return res.redirect("/payment");
  },

  // GET /netsqr/status/:invoiceId
  netsQrStatus: (req, res) => {
    return res.status(400).json({ ok: false, error: "Not supported" });
  },

  /**
   * POST /netsqr/webhook
   * NETS server-to-server callback.
   */
  netsQrWebhook: (req, res) => {
    try {
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("NETS webhook error:", e);
      return res.status(200).json({ ok: true });
    }
  },

  // GET /invoice/:id
  viewInvoice: (req, res) => {
    const user = req.session.user;
    const invoiceId = parseInt(req.params.id, 10);
    if (!user) return res.redirect("/login");
    if (Number.isNaN(invoiceId)) return res.redirect("/payment");

    Invoice.getById(invoiceId, user.id, (err, data) => {
      if (err) return res.redirect("/payment");
      const header = data.header || {};
      const items = (data.items || []).map((it) => ({
        ...it,
        unit_price: Number(it.unit_price) || 0,
        subtotal: Number(it.subtotal) || 0,
        quantity: parseInt(it.quantity, 10) || 0,
        days: parseInt(it.days, 10) || 0
      }));

      res.render("invoice", {
        user,
        header: {
          invoiceRef: header.invoice_ref || header.invoiceRef || `INV-${invoiceId}`,
          paymentMethod: header.payment_method || header.paymentMethod || "NETSQR",
          startDate: header.start_date || header.startDate || "",
          endDate: header.end_date || header.endDate || "",
          days: header.days || 0,
          subtotal: Number(header.subtotal) || 0,
          tax: Number(header.tax) || 0,
          totalAmount: Number(header.total_amount || header.totalAmount || 0)
        },
        items
      });
    });
  },

  // POST /admin/payments/:id/refund
  adminRefund: (req, res) => {
    const admin = req.session.user;
    const paymentId = parseInt(req.params.id, 10);
    const amount = (req.body.amount || "").trim();
    const reason = (req.body.reason || "").trim();

    if (!admin || admin.role !== "admin") return res.status(403).send("Forbidden");
    if (Number.isNaN(paymentId)) return res.status(400).send("Invalid payment id");

    Invoice.refundPayment({ paymentId, adminUserId: admin.id, amount, reason }, (err) => {
      if (err) {
        return res.status(400).send(err.message || "Could not refund payment");
      }
      return res.redirect("/admin/bookings");
    });
  },

  // GET /history -> view bookings/payments
  history: (req, res) => {
    const guard = requireCustomer(req, res);
    if (guard) return;

    const userId = req.session.user.id;
    Invoice.listHistoryByUser(userId, (err, rows) => {
      if (err) return res.status(500).send("Database error");
      res.render("history", { user: req.session.user, rows });
    });
  }
};
