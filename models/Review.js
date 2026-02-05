const db = require("../config/db");

module.exports = {
  getForStorage: (storageId, callback) => {
    const sql = `
      SELECT r.review_id, r.storage_id, r.user_id, r.rating, r.comment, r.created_at,
             u.name AS user_name
      FROM reviews r
      JOIN users u ON u.user_id = r.user_id
      WHERE r.storage_id = ?
      ORDER BY r.created_at DESC
    `;
    db.query(sql, [storageId], callback);
  },

  getAvgForStorage: (storageId, callback) => {
    db.query(
      `SELECT AVG(rating) AS avg_rating, COUNT(*) AS review_count FROM reviews WHERE storage_id = ?`,
      [storageId],
      (err, rows) => {
        if (err) return callback(err);
        const avg = rows && rows[0] ? Number(rows[0].avg_rating) || 0 : 0;
        const count = rows && rows[0] ? Number(rows[0].review_count) || 0 : 0;
        return callback(null, { avg, count });
      }
    );
  },

  create: ({ storageId, userId, rating, comment }, callback) => {
    db.query(
      `INSERT INTO reviews (storage_id, user_id, rating, comment, created_at) VALUES (?, ?, ?, ?, NOW())`,
      [storageId, userId, rating, comment || null],
      callback
    );
  }
};
