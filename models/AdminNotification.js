const db = require("../config/db");

module.exports = {
  create: ({ providerId, type, message }, callback) => {
    const sql = `
      INSERT INTO admin_notifications (provider_id, type, message)
      VALUES (?, ?, ?)
    `;
    db.query(sql, [providerId || null, type, message], callback);
  },

  listAll: (callback) => {
    const sql = `
      SELECT n.notification_id, n.provider_id, n.type, n.message, n.is_read, n.created_at,
             u.name AS provider_name, u.email AS provider_email
      FROM admin_notifications n
      LEFT JOIN users u ON u.user_id = n.provider_id
      ORDER BY n.created_at DESC, n.notification_id DESC
    `;
    db.query(sql, callback);
  },

  existsThisMonth: ({ providerId, type }, callback) => {
    const sql = `
      SELECT COUNT(*) AS total
      FROM admin_notifications
      WHERE provider_id = ? AND type = ?
        AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
    `;
    db.query(sql, [providerId, type], (err, rows) => {
      if (err) return callback(err);
      const total = rows && rows[0] ? Number(rows[0].total || 0) : 0;
      return callback(null, total > 0);
    });
  },
};
