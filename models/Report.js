const db = require("../config/db");

module.exports = {
  getOverview: (callback) => {
    const sql = `
      SELECT
        (SELECT COUNT(*) FROM bookings) AS total_bookings,
        (SELECT COUNT(*) FROM bookings WHERE status = 'Paid') AS paid_bookings,
        (SELECT COUNT(*) FROM users WHERE role = 'customer') AS total_customers,
        (SELECT COALESCE(SUM(amount - COALESCE(refunded_amount, 0)), 0) FROM payments) AS total_revenue
    `;
    db.query(sql, (err, rows) => {
      if (err) return callback(err);
      return callback(null, rows && rows[0] ? rows[0] : {});
    });
  },

  getMonthlyRevenue: (callback) => {
    const sql = `
      SELECT
        DATE_FORMAT(payment_date, '%Y-%m') AS month,
        COALESCE(SUM(amount - COALESCE(refunded_amount, 0)), 0) AS revenue
      FROM payments
      WHERE payment_date IS NOT NULL
      GROUP BY DATE_FORMAT(payment_date, '%Y-%m')
      ORDER BY month DESC
      LIMIT 12
    `;
    db.query(sql, callback);
  },

  getRevenueByMethod: (callback) => {
    const sql = `
      SELECT
        method,
        COUNT(*) AS payments,
        COALESCE(SUM(amount - COALESCE(refunded_amount, 0)), 0) AS revenue
      FROM payments
      GROUP BY method
      ORDER BY revenue DESC
    `;
    db.query(sql, callback);
  },

  getTopStorage: (callback) => {
    const sql = `
      SELECT
        s.storage_id,
        s.title,
        COALESCE(SUM(p.amount - COALESCE(p.refunded_amount, 0)), 0) AS revenue,
        COUNT(*) AS bookings
      FROM bookings b
      JOIN storage_spaces s ON s.storage_id = b.storage_id
      LEFT JOIN payments p ON p.booking_id = b.booking_id
      GROUP BY s.storage_id, s.title
      ORDER BY revenue DESC, bookings DESC
      LIMIT 5
    `;
    db.query(sql, callback);
  },

  getTopCustomers: (callback) => {
    const sql = `
      SELECT
        u.user_id,
        u.name,
        u.email,
        COUNT(DISTINCT b.booking_id) AS bookings,
        COALESCE(SUM(
          CASE WHEN p.payment_date IS NOT NULL
            THEN (p.amount - COALESCE(p.refunded_amount, 0))
            ELSE 0
          END
        ), 0) AS spend
      FROM users u
      LEFT JOIN bookings b ON b.user_id = u.user_id
      LEFT JOIN payments p ON p.booking_id = b.booking_id
      WHERE u.role = 'customer'
      GROUP BY u.user_id, u.name, u.email
      ORDER BY spend DESC, bookings DESC
      LIMIT 10
    `;
    db.query(sql, callback);
  },

  getTopProviders: (callback) => {
    const sql = `
      SELECT
        u.user_id,
        u.name,
        u.email,
        COUNT(DISTINCT s.storage_id) AS listings,
        COUNT(DISTINCT b.booking_id) AS bookings,
        COALESCE(SUM(
          CASE WHEN p.payment_date IS NOT NULL
            THEN (p.amount - COALESCE(p.refunded_amount, 0))
            ELSE 0
          END
        ), 0) AS revenue
      FROM users u
      LEFT JOIN storage_spaces s ON s.provider_id = u.user_id
      LEFT JOIN bookings b ON b.storage_id = s.storage_id
      LEFT JOIN payments p ON p.booking_id = b.booking_id
      WHERE u.role = 'provider'
      GROUP BY u.user_id, u.name, u.email
      ORDER BY revenue DESC, bookings DESC
      LIMIT 10
    `;
    db.query(sql, callback);
  }
};
