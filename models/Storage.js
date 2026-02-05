const db = require("../config/db");

module.exports = {
  getAll: (callback) => {
    db.query(`SELECT * FROM storage_spaces ORDER BY storage_id DESC`, callback);
  },

  getFiltered: ({ q, size, location, type, priceMax }, callback) => {
    const where = [];
    const params = [];

    if (q) {
      where.push(`(title LIKE ? OR description LIKE ? OR location LIKE ?)`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (size) {
      where.push(`size = ?`);
      params.push(size);
    }
    if (location) {
      where.push(`location LIKE ?`);
      params.push(`%${location}%`);
    }
    if (type) {
      where.push(`storage_type = ?`);
      params.push(type);
    }
    if (priceMax) {
      where.push(`COALESCE(price_per_day, price) <= ?`);
      params.push(Number(priceMax) || 0);
    }

    const sql = `
      SELECT s.*,
             COALESCE(r.avg_rating, 0) AS avg_rating,
             COALESCE(r.review_count, 0) AS review_count
      FROM storage_spaces s
      LEFT JOIN (
        SELECT storage_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
        FROM reviews
        GROUP BY storage_id
      ) r ON r.storage_id = s.storage_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY s.storage_id DESC
    `;
    db.query(sql, params, callback);
  },

  getByProvider: (providerId, callback) => {
    db.query(
      `SELECT * FROM storage_spaces WHERE provider_id = ? ORDER BY storage_id DESC`,
      [providerId],
      callback
    );
  },

  create: (data, callback) => {
    db.query(
      `INSERT INTO storage_spaces
        (provider_id, storage_type, title, size, price, price_per_day, location, latitude, longitude, description, status, total_units, available_units)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.provider_id || null,
        data.storage_type || "physical",
        data.title,
        data.size,
        data.price || null,
        data.price_per_day || null,
        data.location || null,
        data.latitude || null,
        data.longitude || null,
        data.description || null,
        data.status || "Available",
        Number(data.total_units) || 1,
        Number(data.available_units) || Number(data.total_units) || 1,
      ],
      callback
    );
  },

  findById: (id, callback) => {
    const sql = `
      SELECT s.*,
             COALESCE(r.avg_rating, 0) AS avg_rating,
             COALESCE(r.review_count, 0) AS review_count
      FROM storage_spaces s
      LEFT JOIN (
        SELECT storage_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
        FROM reviews
        GROUP BY storage_id
      ) r ON r.storage_id = s.storage_id
      WHERE s.storage_id = ?
      LIMIT 1
    `;
    db.query(sql, [id], callback);
  },

  update: (id, data, callback) => {
    db.query(
      `UPDATE storage_spaces
       SET storage_type = ?,
           title = ?,
           size = ?,
           price = ?,
           price_per_day = ?,
           location = ?,
           latitude = ?,
           longitude = ?,
           description = ?,
           status = ?,
           total_units = ?,
           available_units = ?
       WHERE storage_id = ?`,
      [
        data.storage_type || "physical",
        data.title,
        data.size,
        data.price || null,
        data.price_per_day || null,
        data.location || null,
        data.latitude || null,
        data.longitude || null,
        data.description || null,
        data.status || "Available",
        Number(data.total_units) || 1,
        Number(data.available_units) || Number(data.total_units) || 1,
        id,
      ],
      callback
    );
  },

  decrementAvailability: ({ storageId, qty }, callback) => {
    db.query(
      `UPDATE storage_spaces
       SET available_units = available_units - ?
       WHERE storage_id = ? AND available_units >= ?`,
      [Number(qty) || 0, storageId, Number(qty) || 0],
      callback
    );
  },

  incrementAvailability: ({ storageId, qty }, callback) => {
    db.query(
      `UPDATE storage_spaces
       SET available_units = LEAST(total_units, available_units + ?)
       WHERE storage_id = ?`,
      [Number(qty) || 0, storageId],
      callback
    );
  },

  remove: (id, callback) => {
    db.query(`DELETE FROM storage_spaces WHERE storage_id = ?`, [id], callback);
  },
};
