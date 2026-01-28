const db = require("../config/db");

module.exports = {
    createUser: (data, callback) => {
        db.query(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES (?, ?, SHA1(?), ?)`,
            [data.name, data.email, data.password, data.role],
            callback
        );
    },

    findByEmail: (email, callback) => {
        db.query(
            `SELECT * FROM users WHERE email = ?`,
            [email],
            callback
        );
    },

    getAll: (callback) => {
        db.query(
            `SELECT user_id, name, email, role FROM users`,
            callback
        );
    },

    findById: (id, callback) => {
        db.query(
            `SELECT user_id, name, email, role FROM users WHERE user_id = ?`,
            [id],
            callback
        );
    },

    getWalletBalance: (id, callback) => {
        db.query(
            `SELECT COALESCE(wallet_balance, 0) AS wallet_balance FROM users WHERE user_id = ?`,
            [id],
            (err, rows) => {
                if (err) return callback(err);
                const balance = rows && rows[0] ? Number(rows[0].wallet_balance) || 0 : 0;
                return callback(null, balance);
            }
        );
    },

    adjustWalletBalance: (id, delta, callback) => {
        db.query(
            `UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ? WHERE user_id = ?`,
            [Number(delta) || 0, id],
            (err) => {
                if (err) return callback(err);
                return module.exports.getWalletBalance(id, callback);
            }
        );
    },

    update: (id, data, callback) => {
        db.query(
            `UPDATE users SET name = ?, email = ?, role = ? WHERE user_id = ?`,
            [data.name, data.email, data.role, id],
            callback
        );
    },

    remove: (id, callback) => {
        db.query(
            `DELETE FROM users WHERE user_id = ?`,
            [id],
            callback
        );
    }
};
