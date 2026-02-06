const db = require("../config/db");

module.exports = {
  listByProvider: (providerId, callback) => {
    const sql = `
      SELECT promo_id, code, discount_percent, start_date, end_date, status, created_at
      FROM provider_promotions
      WHERE provider_id = ?
      ORDER BY created_at DESC, promo_id DESC
    `;
    db.query(sql, [providerId], callback);
  },

  create: ({ providerId, code, discount_percent, start_date, end_date }, callback) => {
    const sql = `
      INSERT INTO provider_promotions
        (provider_id, code, discount_percent, start_date, end_date, status)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE')
    `;
    db.query(sql, [providerId, code, discount_percent, start_date || null, end_date || null], callback);
  },

  countActiveByProvider: (providerId, callback) => {
    const sql = `
      SELECT COUNT(*) AS active_promos
      FROM provider_promotions
      WHERE provider_id = ? AND status = 'ACTIVE'
    `;
    db.query(sql, [providerId], (err, rows) => {
      if (err) return callback(err);
      const count = rows && rows[0] ? Number(rows[0].active_promos || 0) : 0;
      return callback(null, count);
    });
  },
};
