const db = require('../config/db');

const AdminModel = {

  // TOTAL RENTALS
  getTotalRentals(callback) {
    const sql = `SELECT COUNT(*) AS totalRentals FROM rentals`;
    db.query(sql, callback);
  },

  // TOTAL REVENUE
  getTotalRevenue(callback) {
    const sql = `
      SELECT 
        SUM(
          DATEDIFF(end_date, start_date) * price_per_day * quantity
        ) AS totalRevenue
      FROM rentals
      WHERE status = 'Completed'
    `;
    db.query(sql, callback);
  },

  // REVENUE BY CATEGORY
  getRevenueByCategory(callback) {
    const sql = `
      SELECT 
        category,
        SUM(DATEDIFF(end_date, start_date) * price_per_day * quantity) AS revenue
      FROM rentals
      WHERE status = 'Completed'
      GROUP BY category
      ORDER BY revenue DESC
    `;
    db.query(sql, callback);
  },

  // MOST RENTED CATEGORY
  getMostRentedCategory(callback) {
    const sql = `
      SELECT 
        category,
        SUM(quantity) AS totalQuantity
      FROM rentals
      GROUP BY category
      ORDER BY totalQuantity DESC
      LIMIT 1
    `;
    db.query(sql, callback);
  }
};

module.exports = AdminModel;
