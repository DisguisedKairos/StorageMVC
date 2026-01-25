const db = require("../config/db");

module.exports = {
    getUserBookings: (user_id, callback) => {
        db.query(
            `SELECT * FROM bookings WHERE user_id = ?`,
            [user_id],
            callback
        );
    }
};
