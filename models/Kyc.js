const db = require("../config/db");

module.exports = {
  upsertForProvider: ({ userId, full_name, id_type, id_number }, callback) => {
    const sql = `
      INSERT INTO kyc_requests (user_id, full_name, id_type, id_number, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'PENDING', NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        full_name = VALUES(full_name),
        id_type = VALUES(id_type),
        id_number = VALUES(id_number),
        status = 'PENDING',
        updated_at = NOW()
    `;
    db.query(sql, [userId, full_name, id_type, id_number], callback);
  },

  getByUserId: (userId, callback) => {
    db.query(`SELECT * FROM kyc_requests WHERE user_id = ? LIMIT 1`, [userId], (err, rows) => {
      if (err) return callback(err);
      return callback(null, rows && rows[0] ? rows[0] : null);
    });
  },

  listAll: (callback) => {
    const sql = `
      SELECT k.*, u.email, u.name
      FROM kyc_requests k
      JOIN users u ON u.user_id = k.user_id
      ORDER BY k.updated_at DESC
    `;
    db.query(sql, callback);
  },

  setStatus: ({ id, status, adminId }, callback) => {
    db.query(
      `UPDATE kyc_requests SET status = ?, reviewed_by = ?, updated_at = NOW() WHERE kyc_id = ?`,
      [status, adminId || null, id],
      callback
    );
  },
};
