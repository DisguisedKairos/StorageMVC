const db = require("../config/db");

module.exports = {
  addMany: ({ storageId, paths }, callback) => {
    if (!paths || paths.length === 0) return callback(null);
    const values = paths.map((p, idx) => [storageId, p, idx === 0 ? 1 : 0]);
    db.query(
      `INSERT INTO storage_images (storage_id, image_path, is_primary)
       VALUES ?`,
      [values],
      callback
    );
  },

  listByStorage: (storageId, callback) => {
    db.query(
      `SELECT image_id, image_path, is_primary
       FROM storage_images
       WHERE storage_id = ?
       ORDER BY is_primary DESC, image_id DESC`,
      [storageId],
      callback
    );
  },

  getPrimaryForStorageIds: (storageIds, callback) => {
    if (!storageIds || storageIds.length === 0) return callback(null, []);
    db.query(
      `SELECT storage_id, image_path
       FROM storage_images
       WHERE storage_id IN (?) AND is_primary = 1`,
      [storageIds],
      callback
    );
  }
};
