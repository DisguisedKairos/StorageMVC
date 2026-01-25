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
