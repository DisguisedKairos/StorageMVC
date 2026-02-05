const Cart = require("../models/Cart");
const Invoice = require("../models/Invoice");
const User = require("../models/User");
const LoyaltyPoints = require("../models/LoyaltyPoints");

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

function checkStockAvailability(items, startDate, endDate, callback) {
  if (!items || items.length === 0) return callback(null, true);
  const db = require("../config/db");
  if (!startDate || !endDate) return callback(new Error("Invalid dates"));
  
  const ids = [...new Set(items.map((i) => i.storage_id))];
  if (ids.length === 0) return callback(null, true);
  
  // Check for overlapping bookings during requested date range
  db.query(
    `SELECT storage_id, COUNT(*) as overlap_count FROM bookings 
     WHERE storage_id IN (?) 
     AND status IN ('confirmed', 'active') 
     AND start_date <= ? AND end_date >= ?
     GROUP BY storage_id`,
    [ids, endDate, startDate],
    (err, overlaps) => {
      if (err) return callback(err);
      
      const overlapMap = new Map((overlaps || []).map((o) => [o.storage_id, Number(o.overlap_count)]));
      
      db.query(
        `SELECT storage_id, total_units FROM storage_spaces WHERE storage_id IN (?)`,
        [ids],
        (errUnits, units) => {
          if (errUnits) return callback(errUnits);
          const unitsMap = new Map((units || []).map((u) => [u.storage_id, Number(u.total_units ?? 1)]));
          
          for (const it of items) {
            const totalSlots = unitsMap.has(it.storage_id) ? unitsMap.get(it.storage_id) : 1;
            const activeBookings = overlapMap.has(it.storage_id) ? overlapMap.get(it.storage_id) : 0;
            const availableSlots = totalSlots - activeBookings;
            
            if (availableSlots < it.quantity) {
              return callback(new Error(`Insufficient availability for storage #${it.storage_id} (need ${it.quantity}, available ${availableSlots})`));
            }
          }
          return callback(null, true);
        }
      );
    }
  );
}

function decrementStock(items, callback) {
  const db = require("../config/db");
  if (!items || items.length === 0) return callback(null, true);

  const updates = items.map((it) => [it.quantity, it.storage_id]);
  const run = (i) => {
    if (i >= updates.length) return callback(null, true);
    const [qty, storageId] = updates[i];
    db.query(
      `UPDATE storage_spaces
       SET available_units = GREATEST(0, available_units - ?),
           status = CASE WHEN (available_units - ?) <= 0 THEN 'Rented' ELSE 'Available' END
       WHERE storage_id = ?`,
      [qty, qty, storageId],
      (err) => {
        if (err) return callback(err);
        return run(i + 1);
      }
    );
  };
  run(0);
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
    // default dates: today -> today + 6 days
    const today = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10);
    const startDate = fmt(today);
    const endDate = fmt(new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000));

    computeCartTotals(userId, startDate, endDate, (err, summary) => {
      if (err) return res.status(500).send("Database error");

      User.getWalletBalance(userId, (errW, walletBalance) => {
        if (!errW) req.session.user.walletBalance = walletBalance;

        res.render("payment", {
          user: req.session.user,
          items: summary.items,
          totalPerDay: summary.totalPerDay,
          startDate,
          endDate,
          subtotal: summary.subtotal,
          tax: summary.tax,
          totalAmount: summary.totalAmount,
          walletBalance: walletBalance || 0,
          selectedMethod: req.session.paymentMethod || ""
        });
      });
    });
  },

  // POST /payment -> create bookings + payments, clear cart, render invoice
  processPayment: (req, res) => {
    const guard = requireCustomer(req, res);
    if (guard) return;

    const userId = req.session.user.id;
    const { start_date, end_date, method, paymentMethod: paymentMethodBody } = req.body;

    const dayCount = daysBetweenInclusive(start_date, end_date);
    if (!dayCount || dayCount <= 0) {
      return res.status(400).send("Invalid start or end date");
    }

    const paymentMethod = (paymentMethodBody || method || "").trim();
    const allowed = ["Stripe", "Cash", "PayPal", "NETSQR", "EWallet", "PayNow"];
    if (!allowed.includes(paymentMethod)) {
      return res.status(400).send("Invalid payment method");
    }

    if (paymentMethod === "EWallet") {
      return computeCartTotals(userId, start_date, end_date, (err, summary) => {
        if (err) return res.status(400).send(err.message || "Checkout failed");

        checkStockAvailability(summary.items, start_date, end_date, (errStock) => {
          if (errStock) return res.status(400).send(errStock.message || "Insufficient stock");

          const totalAmount = Number(summary.totalAmount) || 0;
          User.getWalletBalance(userId, (errW, balance) => {
            if (errW) return res.status(500).send("Could not load wallet balance");
            if (balance < totalAmount) return res.status(400).send("Insufficient wallet balance");

            Invoice.createFromCart(userId, start_date, end_date, "EWallet", (errInv, data) => {
              if (errInv) return res.status(400).send(errInv.message || "Checkout failed");

              decrementStock(summary.items, () => {});
              
              // Update wallet balance and ensure session is saved before rendering
              User.adjustWalletBalance(userId, -totalAmount, (errAdj, newBalance) => {
                if (!errAdj && newBalance !== undefined) {
                  req.session.user.walletBalance = newBalance;
                  req.session.user.wallet_balance = newBalance;
                }

                // Record wallet transaction for this purchase
                const WalletTransaction = require("../models/WalletTransaction");
                const description = `Payment for booking from ${start_date} to ${end_date}`;
                WalletTransaction.create({
                  user_id: userId,
                  type: "purchase",
                  amount: totalAmount,
                  description: description,
                  status: "completed"
                }, (errTx) => {
                  if (errTx) console.error("Error recording wallet transaction:", errTx);
                  
                  // Award loyalty points after successful payment
                  LoyaltyPoints.awardPoints(
                    userId,
                    totalAmount,
                    `BOOKING-${Date.now()}`,
                    `Earned from booking ${start_date} to ${end_date}`,
                    (errLoyalty) => {
                      if (errLoyalty) console.error("Error awarding loyalty points:", errLoyalty);
                      
                      // Save session and then render
                      req.session.save((saveErr) => {
                        if (saveErr) console.error("Session save error:", saveErr);
                        
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

                        return res.render("invoice", {
                          user: req.session.user,
                          header: data.header,
                          items: data.items,
                          paymentMethod: "EWallet"
                        });
                      });
                    }
                  );
                });
              });
            });
          });
        });
      });
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
        checkStockAvailability(summary.items, start_date, end_date, async (errStock) => {
          if (errStock) return res.status(400).send(errStock.message || "Insufficient stock");

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
      });
    }

    computeCartTotals(userId, start_date, end_date, (errSum, summary) => {
      if (errSum) return res.status(400).send(errSum.message || "Checkout failed");
      checkStockAvailability(summary.items, start_date, end_date, (errStock) => {
        if (errStock) return res.status(400).send(errStock.message || "Insufficient stock");

        Invoice.createFromCart(userId, start_date, end_date, paymentMethod, (err, data) => {
        if (err) {
          // keep it simple to match your current UI (no flash)
          return res.status(400).send(err.message || "Checkout failed");
        }

        decrementStock(summary.items, () => {});

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

        return computeCartTotals(user.id, pending.start_date, pending.end_date, (errT, summary) => {
          if (errT) return res.status(400).json({ error: errT.message || "Checkout failed" });

          checkStockAvailability(summary.items, pending.start_date, pending.end_date, (errStock) => {
            if (errStock) return res.status(400).json({ error: errStock.message || "Insufficient stock" });

          const expected = Number(summary.totalAmount || 0);
          const capturedValue = Number(
            capture?.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ||
            capture?.purchase_units?.[0]?.amount?.value ||
            0
          );

          if (Math.abs(capturedValue - expected) > 0.01) {
            return res.status(400).json({ error: "Captured amount mismatch" });
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
              decrementStock(summary.items, () => {});
              
              // Award loyalty points after successful payment
              LoyaltyPoints.awardPoints(
                user.id,
                data.header.totalAmount,
                `INVOICE-${data.header.invoice_id}`,
                `Earned from PayPal payment on invoice ${data.header.invoice_id}`,
                (errLoyalty) => {
                  if (errLoyalty) console.error("Error awarding loyalty points:", errLoyalty);
                  return res.json({ ok: true, redirect: "/payment/success" });
                }
              );
            }
          );
          });
        });
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

        return computeCartTotals(user.id, pending.start_date, pending.end_date, (errT, summary) => {
          if (errT) return res.redirect("/payment");

          checkStockAvailability(summary.items, pending.start_date, pending.end_date, (errStock) => {
            if (errStock) return res.redirect("/payment");

          const expectedCents = Math.round(Number(summary.totalAmount || 0) * 100);
          if (session.amount_total && session.amount_total !== expectedCents) {
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
              decrementStock(summary.items, () => {});
              
              // Award loyalty points after successful payment
              LoyaltyPoints.awardPoints(
                user.id,
                data.header.totalAmount,
                `INVOICE-${data.header.invoice_id}`,
                `Earned from Stripe payment on invoice ${data.header.invoice_id}`,
                (errLoyalty) => {
                  if (errLoyalty) console.error("Error awarding loyalty points:", errLoyalty);
                  return res.redirect("/payment/success");
                }
              );
            }
          );
          });
        });
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
    if (!req.session.user) return res.status(401).end();
    if (!txnRetrievalRef) return res.status(400).end();
    if (!pending || pending.method !== "NETSQR") {
      return res.status(400).end();
    }

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

  // POST /netsqr/finalize -> finalize booking/payment after NETS success
  netsQrFinalize: (req, res) => {
    const user = req.session.user;
    const pending = req.session.pendingPayment;
    if (!user) return res.status(401).json({ ok: false, error: "Not logged in" });
    if (!pending || pending.method !== "NETSQR") {
      return res.status(400).json({ ok: false, error: "No pending NETS payment" });
    }

    Invoice.createFromCart(
      user.id,
      pending.start_date,
      pending.end_date,
      "NETSQR",
      (err, data) => {
        if (err) return res.status(400).json({ ok: false, error: err.message || "checkout_failed" });
        req.session.lastInvoice = data;
        delete req.session.pendingPayment;
        computeCartTotals(user.id, pending.start_date, pending.end_date, (errSum, summary) => {
          if (!errSum) decrementStock(summary.items, () => {});
        });
        
        // Award loyalty points after successful NETS payment
        LoyaltyPoints.awardPoints(
          user.id,
          data.header.totalAmount,
          `INVOICE-${data.header.invoice_id}`,
          `Earned from NETSQR payment on invoice ${data.header.invoice_id}`,
          (errLoyalty) => {
            if (errLoyalty) console.error("Error awarding loyalty points:", errLoyalty);
            return res.json({ ok: true });
          }
        );
      }
    );
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
      if (err) {
        return Invoice.getByBookingId(invoiceId, user.id, (bkErr, bkData) => {
          if (bkErr) return res.redirect("/payment");
          return res.render("invoice", {
            user,
            header: bkData.header,
            items: bkData.items
          });
        });
      }

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
          paymentRef: header.provider_ref || header.providerRef || null,
          paymentDate: header.paid_at || header.paidAt || null,
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
      Invoice.listInvoicesByUser(userId, (errInv, invoices) => {
        if (errInv) return res.status(500).send("Database error");

        const bookingRows = (rows || []).map((r) => ({
          type: "Booking",
          id: r.booking_id,
          ref: `BOOKING-${r.booking_id}`,
          title: r.title || `Storage #${r.storage_id}`,
          location: r.location || "N/A",
          size: r.size || "",
          startDate: r.start_date,
          endDate: r.end_date,
          total: Number(r.total_price) || 0,
          status: r.status || "Pending",
          paymentMethod: r.method || "N/A",
          paymentDate: r.payment_date || null,
          viewLink: r.booking_id ? `/invoice/${r.booking_id}` : null
        }));

        const invoiceRows = (invoices || []).map((r) => ({
          type: "Invoice",
          id: r.id,
          ref: r.invoice_ref || `INV-${r.id}`,
          title: "Invoice",
          location: "",
          size: "",
          startDate: r.start_date,
          endDate: r.end_date,
          total: Number(r.total_amount) || 0,
          status: r.status || "PENDING",
          paymentMethod: r.payment_method || "N/A",
          paymentDate: r.paid_at || null,
          viewLink: `/invoice/${r.id}`
        }));

        const combined = [...bookingRows, ...invoiceRows].sort((a, b) => {
          const aDate = new Date(a.paymentDate || a.endDate || a.startDate || 0).getTime();
          const bDate = new Date(b.paymentDate || b.endDate || b.startDate || 0).getTime();
          return bDate - aDate;
        });

        res.render("history", { user: req.session.user, combined });
      });
    });
  }
};
