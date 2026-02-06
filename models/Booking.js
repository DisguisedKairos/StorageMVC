const db = require("../config/db");

module.exports = {
    getUserBookings: (user_id, callback) => {
        db.query(
            `SELECT * FROM bookings WHERE user_id = ?`,
            [user_id],
            callback
        );
    },

    getAll: (callback) => {
        const sql = `
            SELECT
                b.booking_id,
                b.user_id,
                b.storage_id,
                b.quantity,
                b.start_date,
                b.end_date,
                b.total_price,
                b.status,
                u.name AS user_name,
                u.email AS user_email,
                s.title,
                s.location,
                s.size,
                p.payment_id,
                p.amount,
                p.method,
                p.payment_date,
                p.refunded_amount,
                p.refund_status
            FROM bookings b
            JOIN users u ON b.user_id = u.user_id
            JOIN storage_spaces s ON b.storage_id = s.storage_id
            LEFT JOIN payments p ON p.booking_id = b.booking_id
            ORDER BY b.booking_id DESC
        `;
        db.query(sql, callback);
    },

    findById: (id, callback) => {
        db.query(
            `SELECT * FROM bookings WHERE booking_id = ?`,
            [id],
            callback
        );
    },

    update: (id, data, callback) => {
        db.query(
            `UPDATE bookings SET start_date = ?, end_date = ?, status = ? WHERE booking_id = ?`,
            [data.start_date, data.end_date, data.status, id],
            callback
        );
    },

    remove: (id, callback) => {
        db.query(
            `DELETE FROM bookings WHERE booking_id = ?`,
            [id],
            callback
        );
    }
};
