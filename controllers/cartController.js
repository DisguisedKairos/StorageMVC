const Cart = require("../models/Cart");

function requireCustomer(req, res) {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role !== "customer") return res.status(403).send("Not authorized");
}

module.exports = {
  viewCart: (req, res) => {
    const guard = requireCustomer(req, res);
    if (guard) return;

    const userId = req.session.user.id;
    Cart.getItemsByUser(userId, (err, items) => {
      if (err) return res.status(500).send("Database error");
      const total = items.reduce((sum, i) => sum + Number(i.unit_price) * Number(i.quantity), 0);
      res.render("cart", { items, total });
    });
  },

  add: (req, res) => {
    const guard = requireCustomer(req, res);
    if (guard) return;
    const userId = req.session.user.id;
    const storageId = parseInt(req.body.storage_id, 10);
    if (!storageId) return res.redirect("/storage");
    Cart.addItem(userId, storageId, () => res.redirect("/cart"));
  },

  update: (req, res) => {
    const guard = requireCustomer(req, res);
    if (guard) return;
    const userId = req.session.user.id;
    const storageId = parseInt(req.body.storage_id, 10);
    const quantity = Math.max(1, parseInt(req.body.quantity, 10) || 1);
    Cart.updateQuantity(userId, storageId, quantity, () => res.redirect("/cart"));
  },

  remove: (req, res) => {
    const guard = requireCustomer(req, res);
    if (guard) return;
    const userId = req.session.user.id;
    const storageId = parseInt(req.body.storage_id, 10);
    Cart.removeItem(userId, storageId, () => res.redirect("/cart"));
  }
};
