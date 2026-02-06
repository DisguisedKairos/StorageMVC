const Storage = require("../models/Storage");
const Kyc = require("../models/Kyc");
const Promotion = require("../models/Promotion");
const StorageImage = require("../models/StorageImage");
const db = require("../config/db");

function getUserId(req) {
  return (req.session?.user?.id || req.session?.user?.user_id);
}

function requireProvider(req, res) {
  // Return true when access is blocked so callers can stop execution.
  if (!req.session || !req.session.user) {
    res.redirect("/login");
    return true;
  }
  if (req.session.user.role !== "provider") {
    res.status(403).send("Not authorized");
    return true;
  }
  return false;
}

function requireKycApproved(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/login");
  Kyc.getByUserId(getUserId(req), (err, row) => {
    if (err) return res.status(500).send("Database error");
    if (!row || row.status !== "APPROVED") {
      return res.redirect("/provider/kyc");
    }
    next();
  });
}

module.exports = {
  dashboard: (req, res) => {
    const guard = requireProvider(req, res);
    if (guard) return;

    Kyc.getByUserId(getUserId(req), (err, kyc) => {
      if (err) return res.status(500).send("Database error");
      Storage.getByProvider(getUserId(req), (sErr, listings) => {
        if (sErr) return res.status(500).send("Database error");
        // Provider booking summary
        const sql = `
          SELECT COUNT(*) AS total_bookings, COALESCE(SUM(b.total_price), 0) AS total_revenue
          FROM bookings b
          JOIN storage_spaces s ON s.storage_id = b.storage_id
          WHERE s.provider_id = ? AND b.status IN ('Paid','Resolved','Active','Completed')
        `;
        db.query(sql, [getUserId(req)], (bErr, rows) => {
          if (bErr) return res.status(500).send("Database error");
          const summary = rows && rows[0] ? rows[0] : { total_bookings: 0, total_revenue: 0 };
          // Low occupancy alerts (high availability ratio)
          const lowSql = `
            SELECT storage_id, title, available_units, total_units,
                   CASE WHEN total_units > 0 THEN (available_units / total_units) ELSE 1 END AS availability_ratio
            FROM storage_spaces
            WHERE provider_id = ?
            ORDER BY availability_ratio DESC
            LIMIT 3
          `;
          db.query(lowSql, [getUserId(req)], (lErr, lowRows) => {
            if (lErr) return res.status(500).send("Database error");

            // Reviews summary + trend
            const reviewSummarySql = `
              SELECT COALESCE(AVG(r.rating), 0) AS avg_rating, COUNT(*) AS review_count
              FROM reviews r
              JOIN storage_spaces s ON s.storage_id = r.storage_id
              WHERE s.provider_id = ?
            `;
            db.query(reviewSummarySql, [getUserId(req)], (rErr, rRows) => {
              if (rErr) return res.status(500).send("Database error");
              const reviewSummary = rRows && rRows[0] ? rRows[0] : { avg_rating: 0, review_count: 0 };

              const reviewTrendSql = `
                SELECT DATE_FORMAT(r.created_at, '%Y-%m') AS month, AVG(r.rating) AS avg_rating, COUNT(*) AS reviews
                FROM reviews r
                JOIN storage_spaces s ON s.storage_id = r.storage_id
                WHERE s.provider_id = ?
                GROUP BY DATE_FORMAT(r.created_at, '%Y-%m')
                ORDER BY month DESC
                LIMIT 6
              `;
              db.query(reviewTrendSql, [getUserId(req)], (tErr, trendRows) => {
                if (tErr) return res.status(500).send("Database error");

                Promotion.countActiveByProvider(getUserId(req), (pErr, promoCount) => {
                  if (pErr) return res.status(500).send("Database error");
                  res.render("provider_dashboard", {
                    kyc,
                    listings: listings || [],
                    summary,
                    lowOccupancy: lowRows || [],
                    reviewSummary,
                    reviewTrend: trendRows || [],
                    activePromos: promoCount || 0
                  });
                });
              });
            });
          });
        });
      });
    });
  },

  showKycForm: (req, res) => {
    const guard = requireProvider(req, res);
    if (guard) return;

    Kyc.getByUserId(getUserId(req), (err, kyc) => {
      if (err) return res.status(500).send("Database error");
      res.render("provider_kyc", { kyc });
    });
  },

  submitKyc: (req, res) => {
    const guard = requireProvider(req, res);
    if (guard) return;

    const payload = {
      userId: getUserId(req),
      full_name: (req.body.full_name || "").trim(),
      id_type: (req.body.id_type || "NRIC").trim(),
      id_number: (req.body.id_number || "").trim(),
    };

    if (!payload.full_name || !payload.id_number) {
      return res.render("provider_kyc", { kyc: { ...payload, status: "PENDING" }, error: "Please fill in all fields." });
    }

    Kyc.upsertForProvider(payload, (err) => {
      if (err) return res.status(500).send("Database error");
      res.redirect("/provider/kyc");
    });
  },

  listStorage: (req, res) => {
    const guard = requireProvider(req, res);
    if (guard) return;

    Storage.getByProvider(getUserId(req), (err, results) => {
      if (err) return res.status(500).send("Database error");
      const ids = (results || []).map((s) => s.storage_id);
      StorageImage.getPrimaryForStorageIds(ids, (iErr, rows) => {
        const primaryMap = {};
        if (!iErr && rows) {
          rows.forEach((r) => {
            primaryMap[r.storage_id] = r.image_path;
          });
        }
        const storageWithImages = (results || []).map((s) => ({
          ...s,
          primary_image: primaryMap[s.storage_id] || null,
        }));
        res.render("provider_storage_list", { storage: storageWithImages });
      });
    });
  },

  showAddStorage: [
    (req, res, next) => {
      const guard = requireProvider(req, res);
      if (guard) return;
      next();
    },
    requireKycApproved,
    (req, res) => {
      res.render("provider_add_storage", { storage: null });
    },
  ],

  addStorage: [
    (req, res, next) => {
      const guard = requireProvider(req, res);
      if (guard) return;
      next();
    },
    requireKycApproved,
    (req, res) => {
      const data = {
        provider_id: getUserId(req),
        storage_type: req.body.storage_type,
        title: req.body.title,
        size: req.body.size,
        price_per_day: req.body.price_per_day,
        location: req.body.location,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        description: req.body.description,
        status: req.body.status,
        total_units: req.body.total_units,
        available_units: req.body.available_units,
      };

      Storage.create(data, (err, result) => {
        if (err) return res.status(500).send("Database error");
        const storageId = result?.insertId;
        const files = req.files || [];
        const paths = files.map((f) => `/uploads/storage/${f.filename}`);
        if (storageId && paths.length) {
          return StorageImage.addMany({ storageId, paths }, () => res.redirect("/provider/storage"));
        }
        res.redirect("/provider/storage");
      });
    },
  ],

  showEditStorage: (req, res) => {
    const guard = requireProvider(req, res);
    if (guard) return;

    const id = parseInt(req.params.id, 10);
    Storage.findById(id, (err, rows) => {
      if (err) return res.status(500).send("Database error");
      const s = rows && rows[0];
      if (!s || Number(s.provider_id) !== Number(getUserId(req))) {
        return res.status(404).send("Listing not found");
      }
      StorageImage.listByStorage(id, (iErr, images) => {
        if (iErr) return res.status(500).send("Database error");
        res.render("provider_edit_storage", { storage: s, images: images || [] });
      });
    });
  },

  updateStorage: (req, res) => {
    const guard = requireProvider(req, res);
    if (guard) return;

    const id = parseInt(req.params.id, 10);
    Storage.findById(id, (err, rows) => {
      if (err) return res.status(500).send("Database error");
      const s = rows && rows[0];
      if (!s || Number(s.provider_id) !== Number(getUserId(req))) {
        return res.status(404).send("Listing not found");
      }

      Storage.update(
        id,
        {
          storage_type: req.body.storage_type,
          title: req.body.title,
          size: req.body.size,
          price_per_day: req.body.price_per_day,
          location: req.body.location,
          latitude: req.body.latitude,
          longitude: req.body.longitude,
          description: req.body.description,
          status: req.body.status,
          total_units: req.body.total_units,
          available_units: req.body.available_units,
        },
        (uErr) => {
          if (uErr) return res.status(500).send("Database error");
          const files = req.files || [];
          const paths = files.map((f) => `/uploads/storage/${f.filename}`);
          if (paths.length) {
            return StorageImage.addMany({ storageId: id, paths }, () => res.redirect("/provider/storage"));
          }
          res.redirect("/provider/storage");
        }
      );
    });
  },

  deleteStorage: (req, res) => {
    const guard = requireProvider(req, res);
    if (guard) return;

    const id = parseInt(req.params.id, 10);
    // Only delete if it belongs to provider
    Storage.findById(id, (err, rows) => {
      if (err) return res.status(500).send("Database error");
      const s = rows && rows[0];
      if (!s || Number(s.provider_id) !== Number(getUserId(req))) {
        return res.status(404).send("Listing not found");
      }
      Storage.remove(id, (dErr) => {
        if (dErr) return res.status(500).send("Database error");
        res.redirect("/provider/storage");
      });
    });
  },

  listBookings: (req, res) => {
    const guard = requireProvider(req, res);
    if (guard) return;

    const sql = `
      SELECT b.*, s.title, s.location, s.size, u.name AS customer_name, u.email AS customer_email
      FROM bookings b
      JOIN storage_spaces s ON s.storage_id = b.storage_id
      JOIN users u ON u.user_id = b.user_id
      WHERE s.provider_id = ?
      ORDER BY b.booking_id DESC
    `;
    db.query(sql, [getUserId(req)], (err, rows) => {
      if (err) return res.status(500).send("Database error");
      res.render("provider_bookings", { bookings: rows || [] });
    });
  },

  calendar: (req, res) => {
    const guard = requireProvider(req, res);
    if (guard) return;

    const sql = `
      SELECT b.booking_id, b.quantity, b.start_date, b.end_date, b.status,
             s.title AS storage_title, u.name AS customer_name
      FROM bookings b
      JOIN storage_spaces s ON s.storage_id = b.storage_id
      JOIN users u ON u.user_id = b.user_id
      WHERE s.provider_id = ?
      ORDER BY b.start_date ASC
    `;
    db.query(sql, [getUserId(req)], (err, rows) => {
      if (err) return res.status(500).send("Database error");
      res.render("provider_calendar", { bookings: rows || [] });
    });
  },

  promotions: (req, res) => {
    const guard = requireProvider(req, res);
    if (guard) return;

    Promotion.listByProvider(getUserId(req), (err, promos) => {
      if (err) return res.status(500).send("Database error");
      res.render("provider_promotions", { promotions: promos || [] });
    });
  },

  createPromotion: (req, res) => {
    const guard = requireProvider(req, res);
    if (guard) return;

    const code = (req.body.code || "").trim().toUpperCase();
    const discount = Math.max(0, Math.min(100, Number(req.body.discount_percent) || 0));
    const start_date = req.body.start_date || null;
    const end_date = req.body.end_date || null;

    if (!code || discount <= 0) {
      return res.redirect("/provider/promotions");
    }

    Promotion.create(
      { providerId: getUserId(req), code, discount_percent: discount, start_date, end_date },
      (err) => {
        if (err) return res.status(500).send("Database error");
        res.redirect("/provider/promotions");
      }
    );
  },
};
