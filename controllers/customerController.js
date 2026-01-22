const Cart = require("../models/Cart");

module.exports = {
  dashboard: (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "customer") return res.status(403).send("Not authorized");

    const userId = req.session.user.id;
    Cart.getItemsByUser(userId, (err, items) => {
      if (err) return res.status(500).send("Database error");
      const preview = items.slice(0, 3);
      res.render("customer_dashboard", { preview, cartCount: items.reduce((s, i) => s + Number(i.quantity), 0) });
    });
  }
};
