const db = require("../config/db");

module.exports = {
    getAll: (callback) => {
        db.query(`SELECT * FROM storage_spaces`, callback);
    },

    create: (data, callback) => {
        db.query(
            `INSERT INTO storage_spaces (title, size, price, price_per_day, location, description, status, total_units, available_units)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.title,
                data.size,
                data.price || null,
                data.price_per_day || null,
                data.location || null,
                data.description || null,
                data.status || "Available",
                Number(data.total_units) || 1,
                Number(data.available_units) || Number(data.total_units) || 1
            ],
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
            `UPDATE storage_spaces
             SET title = ?,
                 size = ?,
                 price = ?,
                 price_per_day = ?,
                 location = ?,
                 description = ?,
                 status = ?,
                 total_units = ?,
                 available_units = ?
             WHERE storage_id = ?`,
            [
                data.title,
                data.size,
                data.price || null,
                data.price_per_day || null,
                data.location || null,
                data.description || null,
                data.status || "Available",
                Number(data.total_units) || 1,
                Number(data.available_units) || Number(data.total_units) || 1,
                id
            ],
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
