const db = require("../config/db");

module.exports = {
    getAll: (callback) => {
        db.query(`SELECT * FROM storage_spaces`, callback);
    },

    create: (data, callback) => {
        db.query(
            `INSERT INTO storage_spaces (title, size, price, location) VALUES (?, ?, ?, ?)`,
            [data.title, data.size, data.price, data.location],
            callback
        );
    },

    findById: (id, callback) => {
        db.query(
            `SELECT * FROM storage_spaces WHERE storage_id = ?`,
            [id],
            callback
        );
    },

    update: (id, data, callback) => {
        db.query(
            `UPDATE storage_spaces SET title=?, size=?, price=?, location=? WHERE storage_id=?`,
            [data.title, data.size, data.price, data.location, id],
            callback
        );
    },

    remove: (id, callback) => {
        db.query(
            `DELETE FROM storage_spaces WHERE storage_id = ?`,
            [id],
            callback
        );
    }
};
