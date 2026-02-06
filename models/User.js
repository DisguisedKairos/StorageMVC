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
            `SELECT user_id, name, email, role, profile_image, phone, address FROM users WHERE user_id = ?`,
            [id],
            (err, rows) => {
                if (err && err.code === "ER_BAD_FIELD_ERROR") {
                    return db.query(
                        `SELECT user_id, name, email, role FROM users WHERE user_id = ?`,
                        [id],
                        callback
                    );
                }
                return callback(err, rows);
            }
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

    updateProfile: (id, data, callback) => {
        const buildQuery = (includeProfile) => {
            const fields = ["name = ?", "email = ?"];
            const params = [data.name, data.email];

            if (data.password) {
                fields.push("password_hash = SHA1(?)");
                params.push(data.password);
            }

            if (includeProfile && typeof data.profileImage !== "undefined") {
                fields.push("profile_image = ?");
                params.push(data.profileImage || null);
            }

            if (includeProfile && typeof data.phone !== "undefined") {
                fields.push("phone = ?");
                params.push(data.phone || null);
            }

            if (includeProfile && typeof data.address !== "undefined") {
                fields.push("address = ?");
                params.push(data.address || null);
            }

            params.push(id);
            return { sql: `UPDATE users SET ${fields.join(", ")} WHERE user_id = ?`, params };
        };

        const first = buildQuery(true);
        db.query(first.sql, first.params, (err) => {
            if (err && err.code === "ER_BAD_FIELD_ERROR") {
                const fallback = buildQuery(false);
                return db.query(fallback.sql, fallback.params, callback);
            }
            return callback(err);
        });
    },

    remove: (id, callback) => {
        db.query(
            `DELETE FROM users WHERE user_id = ?`,
            [id],
            callback
        );
    },

    getLoyaltyPoints: (id, callback) => {
        db.query(
            `SELECT loyalty_points, lifetime_points FROM users WHERE user_id = ?`,
            [id],
            (err, rows) => {
                if (err) return callback(err);
                const points = rows && rows[0] ? { 
                    current: Number(rows[0].loyalty_points) || 0,
                    lifetime: Number(rows[0].lifetime_points) || 0
                } : { current: 0, lifetime: 0 };
                return callback(null, points);
            }
        );
    },

    adjustLoyaltyPoints: (id, delta, callback) => {
        db.query(
            `UPDATE users SET loyalty_points = COALESCE(loyalty_points, 0) + ? WHERE user_id = ?`,
            [Number(delta) || 0, id],
            (err) => {
                if (err) return callback(err);
                return module.exports.getLoyaltyPoints(id, callback);
            }
        );
    }
};
