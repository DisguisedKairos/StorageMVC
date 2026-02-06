const Storage = require("../models/Storage");
const Review = require("../models/Review");
const Complaint = require("../models/Complaint");
const AdminNotification = require("../models/AdminNotification");
const StorageImage = require("../models/StorageImage");
const Kyc = require("../models/Kyc");

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

      const ids = storage.map((s) => s.storage_id);
      StorageImage.getPrimaryForStorageIds(ids, (iErr, rows) => {
        const primaryMap = {};
        if (!iErr && rows) {
          rows.forEach((r) => {
            primaryMap[r.storage_id] = r.image_path;
          });
        }

        const storageWithImages = storage.map((s) => ({
          ...s,
          primary_image: primaryMap[s.storage_id] || null,
        }));

        res.render("storage_list", {
          storage: storageWithImages,
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

        StorageImage.listByStorage(id, (iErr, images) => {
          if (iErr) return res.status(500).send("Database error");
          res.render("storage_detail", {
            storage,
            reviews: reviews || [],
            images: images || [],
          });
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

  addComplaint: (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "customer") return res.status(403).send("Not authorized");

    const storageId = parseInt(req.params.id, 10);
    const title = (req.body.title || "").trim();
    const description = (req.body.description || "").trim();
    if (!storageId || !title || !description) return res.redirect(`/storage/${storageId}`);

    Storage.findById(storageId, (err, rows) => {
      if (err) return res.status(500).send("Database error");
      const storage = rows && rows[0];
      if (!storage) return res.status(404).send("Storage not found");

      const providerId = storage.provider_id;
      Complaint.create(
        { storageId, providerId, customerId: getUserId(req), title, description },
        (cErr) => {
          if (cErr) return res.status(500).send("Database error");

          const reporterId = getUserId(req);
          const singleMessage = `New complaint on storage #${storageId} by user #${reporterId}.`;
          AdminNotification.create({ providerId, type: "complaint", message: singleMessage }, () => {
            Complaint.countProviderMonth(providerId, (cntErr, total) => {
              if (cntErr) return res.redirect(`/storage/${storageId}`);

            if (total >= 10) {
              Kyc.setStatusByUserId({ userId: providerId, status: "REJECTED", adminId: null }, () => {
                AdminNotification.existsThisMonth({ providerId, type: "complaint_threshold" }, (eErr, exists) => {
                  if (!eErr && !exists) {
                    const message = `Provider #${providerId} reached ${total} complaints this month. KYC auto-rejected.`;
                    AdminNotification.create({ providerId, type: "complaint_threshold", message }, () => {
                      return res.redirect(`/storage/${storageId}`);
                    });
                  } else {
                    return res.redirect(`/storage/${storageId}`);
                  }
                });
              });
            } else {
              return res.redirect(`/storage/${storageId}`);
            }
            });
          });
        }
      );
    });
  },
};
