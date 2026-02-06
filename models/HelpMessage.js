const db = require("../config/db");

module.exports = {
  create: ({ userId, subject, message, attachmentPath }, callback) => {
    db.query(
      `INSERT INTO help_messages (user_id, subject, message, attachment_path, status)
       VALUES (?, ?, ?, ?, 'OPEN')`,
      [userId, subject, message, attachmentPath || null],
      callback
    );
  },

  listByUser: (userId, callback) => {
    db.query(
      `SELECT help_id, subject, message, attachment_path, status, admin_reply, created_at, updated_at, responded_at
       FROM help_messages
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId],
      callback
    );
  },

  listAll: (callback) => {
    db.query(
      `SELECT h.help_id, h.user_id, h.subject, h.message, h.attachment_path, h.status, h.admin_reply,
              h.created_at, h.updated_at, h.responded_at, u.name, u.email
       FROM help_messages h
       LEFT JOIN users u ON u.user_id = h.user_id
       ORDER BY h.created_at DESC`,
      callback
    );
  },

  reply: ({ id, adminId, reply, status }, callback) => {
    db.query(
      `UPDATE help_messages
       SET admin_reply = ?, status = ?, responded_at = NOW(), updated_at = NOW(), admin_id = ?
       WHERE help_id = ?`,
      [reply, status || "ANSWERED", adminId, id],
      callback
    );
  },

  addReply: ({ helpId, senderRole, message }, callback) => {
    db.query(
      `INSERT INTO help_message_replies (help_id, sender_role, message)
       VALUES (?, ?, ?)`,
      [helpId, senderRole, message],
      callback
    );
  },

  listRepliesByHelpIds: (helpIds, callback) => {
    if (!helpIds || helpIds.length === 0) return callback(null, []);
    db.query(
      `SELECT reply_id, help_id, sender_role, message, created_at
       FROM help_message_replies
       WHERE help_id IN (?)
       ORDER BY created_at ASC`,
      [helpIds],
      callback
    );
  },

  updateStatus: ({ id, status }, callback) => {
    db.query(
      `UPDATE help_messages
       SET status = ?, updated_at = NOW()
       WHERE help_id = ?`,
      [status || "OPEN", id],
      callback
    );
  },

  remove: (helpId, callback) => {
    db.beginTransaction((txErr) => {
      if (txErr) return callback(txErr);
      db.query(
        `DELETE FROM help_message_replies WHERE help_id = ?`,
        [helpId],
        (rErr) => {
          if (rErr) return db.rollback(() => callback(rErr));
          db.query(
            `DELETE FROM help_messages WHERE help_id = ?`,
            [helpId],
            (hErr) => {
              if (hErr) return db.rollback(() => callback(hErr));
              db.commit((cErr) => {
                if (cErr) return db.rollback(() => callback(cErr));
                return callback(null, true);
              });
            }
          );
        }
      );
    });
  }
};
