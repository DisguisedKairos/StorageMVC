const Storage = require("../models/Storage");
const Kyc = require("../models/Kyc");
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
          res.render("provider_dashboard", { kyc, listings: listings || [], summary });
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
      res.render("provider_storage_list", { storage: results || [] });
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
      res.render("provider_add_storage");
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

      Storage.create(data, (err) => {
        if (err) return res.status(500).send("Database error");
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
      res.render("provider_edit_storage", { storage: s });
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
};
