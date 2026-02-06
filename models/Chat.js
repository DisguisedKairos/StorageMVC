const db = require("../config/db");

module.exports = {
  getContextByBooking: (bookingId, callback) => {
    const sql = `
      SELECT b.booking_id,
             b.user_id AS customer_id,
             c.name AS customer_name,
             c.email AS customer_email,
             s.provider_id,
             p.name AS provider_name,
             p.email AS provider_email,
             s.title AS storage_title
      FROM bookings b
      JOIN storage_spaces s ON s.storage_id = b.storage_id
      LEFT JOIN users c ON c.user_id = b.user_id
      LEFT JOIN users p ON p.user_id = s.provider_id
      WHERE b.booking_id = ?
      LIMIT 1
    `;
    db.query(sql, [bookingId], (err, rows) => {
      if (err) return callback(err);
      return callback(null, rows && rows[0] ? rows[0] : null);
    });
  },

  getOrCreateThread: (bookingId, customerId, providerId, callback) => {
    db.query(
      `SELECT chat_id FROM chat_threads WHERE booking_id = ? LIMIT 1`,
      [bookingId],
      (err, rows) => {
        if (err) return callback(err);
        if (rows && rows[0]) return callback(null, rows[0].chat_id);

        db.query(
          `INSERT INTO chat_threads (booking_id, customer_id, provider_id)
           VALUES (?, ?, ?)`,
          [bookingId, customerId, providerId],
          (iErr, result) => {
            if (iErr) return callback(iErr);
            return callback(null, result.insertId);
          }
        );
      }
    );
  },

  listMessages: (chatId, callback) => {
    db.query(
      `SELECT message_id, sender_role, sender_id, message, created_at
       FROM chat_messages
       WHERE chat_id = ?
       ORDER BY created_at ASC`,
      [chatId],
      callback
    );
  },

  addMessage: ({ chatId, senderRole, senderId, message }, callback) => {
    db.query(
      `INSERT INTO chat_messages (chat_id, sender_role, sender_id, message)
       VALUES (?, ?, ?, ?)`,
      [chatId, senderRole, senderId, message],
      callback
    );
  },

  listThreadsByCustomer: (customerId, callback) => {
    const sql = `
      SELECT t.chat_id, t.booking_id, t.created_at,
             s.title AS storage_title,
             s.location,
             p.name AS provider_name, p.email AS provider_email
      FROM chat_threads t
      LEFT JOIN bookings b ON b.booking_id = t.booking_id
      LEFT JOIN storage_spaces s ON s.storage_id = b.storage_id
      LEFT JOIN users p ON p.user_id = t.provider_id
      WHERE t.customer_id = ?
      ORDER BY t.created_at DESC
    `;
    db.query(sql, [customerId], callback);
  },

  listThreadsByProvider: (providerId, callback) => {
    const sql = `
      SELECT t.chat_id, t.booking_id, t.created_at,
             s.title AS storage_title,
             s.location,
             c.name AS customer_name, c.email AS customer_email
      FROM chat_threads t
      LEFT JOIN bookings b ON b.booking_id = t.booking_id
      LEFT JOIN storage_spaces s ON s.storage_id = b.storage_id
      LEFT JOIN users c ON c.user_id = t.customer_id
      WHERE t.provider_id = ?
      ORDER BY t.created_at DESC
    `;
    db.query(sql, [providerId], callback);
  },

  listBookingsForCustomer: (customerId, callback) => {
    const sql = `
      SELECT b.booking_id, b.start_date, b.end_date,
             s.title AS storage_title, s.location,
             u.name AS provider_name
      FROM bookings b
      LEFT JOIN storage_spaces s ON s.storage_id = b.storage_id
      LEFT JOIN users u ON u.user_id = s.provider_id
      WHERE b.user_id = ?
      ORDER BY b.booking_id DESC
    `;
    db.query(sql, [customerId], callback);
  },

  listBookingsForProvider: (providerId, callback) => {
    const sql = `
      SELECT b.booking_id, b.start_date, b.end_date,
             s.title AS storage_title, s.location,
             c.name AS customer_name
      FROM bookings b
      LEFT JOIN storage_spaces s ON s.storage_id = b.storage_id
      LEFT JOIN users c ON c.user_id = b.user_id
      WHERE s.provider_id = ?
      ORDER BY b.booking_id DESC
    `;
    db.query(sql, [providerId], callback);
  },

  ensureThreadsForCustomer: (customerId, callback) => {
    const sql = `
      INSERT IGNORE INTO chat_threads (booking_id, customer_id, provider_id)
      SELECT b.booking_id, b.user_id, s.provider_id
      FROM bookings b
      JOIN storage_spaces s ON s.storage_id = b.storage_id
      WHERE b.user_id = ? AND s.provider_id IS NOT NULL
    `;
    db.query(sql, [customerId], callback);
  },

  ensureThreadsForProvider: (providerId, callback) => {
    const sql = `
      INSERT IGNORE INTO chat_threads (booking_id, customer_id, provider_id)
      SELECT b.booking_id, b.user_id, s.provider_id
      FROM bookings b
      JOIN storage_spaces s ON s.storage_id = b.storage_id
      WHERE s.provider_id = ?
    `;
    db.query(sql, [providerId], callback);
  }
};
