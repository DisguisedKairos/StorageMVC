const db = require("../config/db");

module.exports = {
  /**
   * Create a wallet transaction record
   */
  create: (data, callback) => {
    db.query(
      `INSERT INTO wallet_transactions (user_id, type, amount, description, status, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [data.user_id, data.type, data.amount, data.description, data.status || "completed"],
      callback
    );
  },

  /**
   * Get wallet transactions for a user
   */
  getByUser: (userId, callback) => {
    db.query(
      `SELECT * FROM wallet_transactions 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [userId],
      (err, results) => {
        if (err && err.code === 'ER_NO_SUCH_TABLE') {
          return callback(null, []);
        }
        callback(err, results);
      }
    );
  },

  /**
   * Get wallet balance for a user
   */
  getBalance: (userId, callback) => {
    db.query(
      `SELECT COALESCE(SUM(CASE 
        WHEN type = 'topup' OR type = 'refund' THEN amount 
        WHEN type = 'purchase' THEN -amount 
        ELSE 0 
       END), 0) as balance 
       FROM wallet_transactions 
       WHERE user_id = ? AND status = 'completed'`,
      [userId],
      (err, rows) => {
        if (err && err.code === 'ER_NO_SUCH_TABLE') {
          return callback(null, 0);
        }
        if (err) return callback(err);
        const balance = rows && rows[0] ? Number(rows[0].balance) || 0 : 0;
        callback(null, balance);
      }
    );
  },

  /**
   * Initialize wallet tables if they don't exist
   */
  initializeTables: (callback) => {
    // First add wallet_balance column to users
    db.query(
      `ALTER TABLE users ADD COLUMN wallet_balance DECIMAL(10, 2) DEFAULT 0.00`,
      (err) => {
        if (err && err.code !== 'ER_DUP_FIELDNAME') {
          console.error('Add wallet_balance error:', err.code);
        }
        
        // Then create wallet_transactions table
        db.query(
          `CREATE TABLE IF NOT EXISTS wallet_transactions (
            transaction_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            type ENUM('topup', 'purchase', 'refund') NOT NULL DEFAULT 'topup',
            amount DECIMAL(10, 2) NOT NULL,
            description VARCHAR(255),
            status ENUM('pending', 'completed', 'failed') NOT NULL DEFAULT 'completed',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
            INDEX idx_user_id (user_id),
            INDEX idx_created_at (created_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
          (err2) => {
            if (err2 && err2.code !== 'ER_TABLE_EXISTS_ERROR') {
              console.error('Create wallet_transactions error:', err2.code);
            }
            callback(null, true);
          }
        );
      }
    );
  },

  /**
   * Top-up wallet balance
   */
  topup: (userId, amount, description, callback) => {
    const amt = Number(amount) || 0;
    if (amt <= 0) return callback(new Error("Invalid amount"));

    db.query(
      `INSERT INTO wallet_transactions (user_id, type, amount, description, status, created_at)
       VALUES (?, 'topup', ?, ?, 'completed', NOW())`,
      [userId, amt, description || "Wallet Top-up"],
      (err) => {
        if (err) {
          if (err.code === 'ER_NO_SUCH_TABLE') {
            return module.exports.initializeTables(() => {
              module.exports.topup(userId, amount, description, callback);
            });
          }
          return callback(err);
        }
        // Update user's wallet_balance for quick access
        db.query(
          `UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ? WHERE user_id = ?`,
          [amt, userId],
          callback
        );
      }
    );
  },

  /**
   * Deduct from wallet balance (for purchases)
   */
  deduct: (userId, amount, description, callback) => {
    const amt = Number(amount) || 0;
    if (amt <= 0) return callback(new Error("Invalid amount"));

    db.query(
      `INSERT INTO wallet_transactions (user_id, type, amount, description, status, created_at)
       VALUES (?, 'purchase', ?, ?, 'completed', NOW())`,
      [userId, amt, description || "Storage Booking"],
      (err) => {
        if (err) return callback(err);
        db.query(
          `UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) - ? WHERE user_id = ?`,
          [amt, userId],
          callback
        );
      }
    );
  },

  /**
   * Refund to wallet balance
   */
  refund: (userId, amount, description, callback) => {
    const amt = Number(amount) || 0;
    if (amt <= 0) return callback(new Error("Invalid amount"));

    db.query(
      `INSERT INTO wallet_transactions (user_id, type, amount, description, status, created_at)
       VALUES (?, 'refund', ?, ?, 'completed', NOW())`,
      [userId, amt, description || "Refund"],
      (err) => {
        if (err) return callback(err);
        db.query(
          `UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ? WHERE user_id = ?`,
          [amt, userId],
          callback
        );
      }
    );
  }
};
