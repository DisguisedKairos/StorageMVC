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
  }
};
