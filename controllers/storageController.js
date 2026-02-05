const Storage = require("../models/Storage");
const Review = require("../models/Review");

function getUserId(req) {
  return (req.session?.user?.id || req.session?.user?.user_id);
}

function dynamicPrice(base, available, total) {
  const b = Number(base) || 0;
  const a = Number(available);
  const t = Number(total);
  if (!b || !t || Number.isNaN(a)) return b;
  // Demand factor: as availability decreases, price increases up to +50%
  const usedRatio = Math.min(1, Math.max(0, 1 - a / t));
  const multiplier = 1 + 0.5 * usedRatio;
  return Number((b * multiplier).toFixed(2));
}

module.exports = {
  // Customer-facing browse page with filters
  browse: (req, res) => {
    const { q, size, location, type, priceMin, priceMax, ratingMin } = req.query;
    const filtersApplied = [q, size, location, type, priceMin, priceMax, ratingMin].some(
      (v) => String(v || "").trim()
    );

    Storage.getFiltered({ q, size, location, type, priceMin, priceMax, ratingMin }, (err, results) => {
      if (err) return res.status(500).send("Database error");

      const storage = (results || []).map((s) => {
        const base = s.price_per_day || s.price;
        return {
          ...s,
          dynamic_price_per_day: dynamicPrice(base, s.available_units, s.total_units),
        };
      });

      res.render("storage_list", {
        storage,
        filtersApplied,
        filters: {
          q: q || "",
          size: size || "",
          location: location || "",
          type: type || "",
          priceMin: priceMin || "",
          priceMax: priceMax || "",
          ratingMin: ratingMin || "",
        },
      });
    });
  },

  detail: (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect("/storage");

    Storage.findById(id, (err, rows) => {
      if (err) return res.status(500).send("Database error");
      const storage = rows && rows[0];
      if (!storage) return res.status(404).send("Storage not found");

      Review.getForStorage(id, (rErr, reviews) => {
        if (rErr) return res.status(500).send("Database error");
        const base = storage.price_per_day || storage.price;
        storage.dynamic_price_per_day = dynamicPrice(base, storage.available_units, storage.total_units);

        res.render("storage_detail", {
          storage,
          reviews: reviews || [],
        });
      });
    });
  },

  addReview: (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "customer") return res.status(403).send("Not authorized");

    const storageId = parseInt(req.params.id, 10);
    const rating = Math.max(1, Math.min(5, parseInt(req.body.rating, 10) || 0));
    const comment = (req.body.comment || "").trim();

    if (!storageId || !rating) return res.redirect("/storage");

    Review.create({ storageId, userId: getUserId(req), rating, comment }, () => {
      return res.redirect(`/storage/${storageId}`);
    });
  },
};
