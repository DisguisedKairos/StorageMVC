const db = require("../config/db");

module.exports = {
  create: ({ storageId, providerId, customerId, title, description }, callback) => {
    const sql = `
      INSERT INTO complaints (storage_id, provider_id, customer_id, title, description)
      VALUES (?, ?, ?, ?, ?)
    `;
    db.query(sql, [storageId, providerId, customerId, title, description], callback);
  },

  countProviderMonth: (providerId, callback) => {
    const sql = `
      SELECT COUNT(*) AS total
      FROM complaints
      WHERE provider_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)
    `;
    db.query(sql, [providerId], (err, rows) => {
      if (err) return callback(err);
      const total = rows && rows[0] ? Number(rows[0].total || 0) : 0;
      return callback(null, total);
    });
  },
};
