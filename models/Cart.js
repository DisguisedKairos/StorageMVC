const db = require("../config/db");

// Cart is persisted in MySQL (cart_items table) so it survives logout/login.
module.exports = {
  // Returns cart items joined with storage info
  getItemsByUser: (userId, callback) => {
    db.query(
      `SELECT c.cart_item_id, c.user_id, c.storage_id, c.quantity,
              s.title, s.size, s.location,
              COALESCE(s.price_per_day, s.price) AS unit_price
       FROM cart_items c
       JOIN storage_spaces s ON c.storage_id = s.storage_id
       WHERE c.user_id = ?
       ORDER BY c.updated_at DESC`,
      [userId],
      callback
    );
  },

  addItem: (userId, storageId, callback) => {
    // uq_user_storage constraint ensures one row per (user, storage)
    db.query(
      `INSERT INTO cart_items (user_id, storage_id, quantity)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
      [userId, storageId],
      callback
    );
  },

  updateQuantity: (userId, storageId, quantity, callback) => {
    db.query(
      `UPDATE cart_items
       SET quantity = ?
       WHERE user_id = ? AND storage_id = ?`,
      [quantity, userId, storageId],
      callback
    );
  },

  removeItem: (userId, storageId, callback) => {
    db.query(
      `DELETE FROM cart_items
       WHERE user_id = ? AND storage_id = ?`,
      [userId, storageId],
      callback
    );
  },

  countItems: (userId, callback) => {
    db.query(
      `SELECT COALESCE(SUM(quantity), 0) AS item_count
       FROM cart_items
       WHERE user_id = ?`,
      [userId],
      callback
    );
  }
};
