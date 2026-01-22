const Cart = require("../models/Cart");
const Invoice = require("../models/Invoice");

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
    const allowed = ["Credit Card", "Debit Card", "PayNow", "Cash", "Online"];
    if (!allowed.includes(paymentMethod)) {
      return res.status(400).send("Invalid payment method");
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
