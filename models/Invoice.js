const db = require("../config/db");

function parseDateOnly(str) {
  // expects YYYY-MM-DD
  const d = new Date(str + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function daysBetweenInclusive(startStr, endStr) {
  const s = parseDateOnly(startStr);
  const e = parseDateOnly(endStr);
  if (!s || !e) return null;
  const ms = e.getTime() - s.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
  return days;
}

module.exports = {
  /**
   * Create bookings + payments from the current user's cart.
   * - Reads cart_items joined with storage_spaces
   * - Inserts one row per cart item into `bookings`
   * - Inserts one payment row per booking into `payments`
   * - Clears the cart
   * Returns a summary object for invoice rendering
   */
  createFromCart: (userId, startDate, endDate, paymentMethod, callback) => {
    const days = daysBetweenInclusive(startDate, endDate);
    if (!days || days <= 0) {
      return callback(new Error("Invalid start/end date"));
    }

    const cartSql = `
      SELECT
        c.storage_id,
        c.quantity,
        s.title,
        s.location,
        s.size,
        COALESCE(s.price_per_day, s.price) AS unit_price
      FROM cart_items c
      JOIN storage_spaces s ON c.storage_id = s.storage_id
      WHERE c.user_id = ?
      ORDER BY c.updated_at DESC
    `;

    db.query(cartSql, [userId], (err, items) => {
      if (err) return callback(err);
      if (!items || items.length === 0) return callback(new Error("Cart is empty"));

      // compute totals
      const lineItems = items.map((it) => {
        const qty = parseInt(it.quantity, 10) || 0;
        const unit = Number(it.unit_price) || 0;
        const subtotal = unit * qty * days;
        return {
          storage_id: it.storage_id,
          title: it.title,
          location: it.location,
          size: it.size,
          quantity: qty,
          unit_price: unit,
          days,
          start_date: startDate,
          end_date: endDate,
          subtotal,
        };
      });

      const subtotal = lineItems.reduce((sum, it) => sum + it.subtotal, 0);
      const tax = 0; // keep simple; adjust if needed
      const totalAmount = subtotal + tax;

      // Create an invoice reference for display (not stored in DB)
      const invoiceRef = "INV-" + Date.now();

      db.beginTransaction((txErr) => {
        if (txErr) return callback(txErr);

        const bookingSql = `
          INSERT INTO bookings (user_id, storage_id, start_date, end_date, total_price, status)
          VALUES (?, ?, ?, ?, ?, 'Pending')
        `;

        const created = [];
        let i = 0;

        const insertNext = () => {
          if (i >= lineItems.length) {
            // clear cart after all bookings/payments inserted
            db.query(`DELETE FROM cart_items WHERE user_id = ?`, [userId], (clearErr) => {
              if (clearErr) return db.rollback(() => callback(clearErr));
              db.commit((commitErr) => {
                if (commitErr) return db.rollback(() => callback(commitErr));
                return callback(null, {
                  header: { invoiceRef, startDate, endDate, days, subtotal, tax, totalAmount, paymentMethod },
                  items: created
                });
              });
            });
            return;
          }

          const it = lineItems[i++];
          db.query(
            bookingSql,
            [userId, it.storage_id, startDate, endDate, it.subtotal],
            (bErr, bRes) => {
              if (bErr) return db.rollback(() => callback(bErr));
              const bookingId = bRes.insertId;

              const paymentSql = `
                INSERT INTO payments (booking_id, amount, method)
                VALUES (?, ?, ?)
              `;
              db.query(paymentSql, [bookingId, it.subtotal, paymentMethod], (pErr, pRes) => {
                if (pErr) return db.rollback(() => callback(pErr));

                created.push({
                  booking_id: bookingId,
                  payment_id: pRes.insertId,
                  ...it
                });

                insertNext();
              });
            }
          );
        };

        insertNext();
      });
    });
  },

  /**
   * Optional: list bookings/payments by user for history page.
   */
  listHistoryByUser: (userId, callback) => {
    const sql = `
      SELECT
        b.booking_id,
        b.storage_id,
        b.start_date,
        b.end_date,
        b.total_price,
        b.status,
        p.payment_id,
        p.method,
        p.payment_date,
        s.title,
        s.location,
        s.size
      FROM bookings b
      LEFT JOIN payments p ON p.booking_id = b.booking_id
      LEFT JOIN storage_spaces s ON s.storage_id = b.storage_id
      WHERE b.user_id = ?
      ORDER BY b.booking_id DESC
    `;
    db.query(sql, [userId], callback);
  },

  /**
   * Admin: list all bookings/payments with user info.
   */
  listAllHistory: (callback) => {
    const sql = `
      SELECT
        b.booking_id,
        b.user_id,
        u.name AS user_name,
        u.email AS user_email,
        b.storage_id,
        b.start_date,
        b.end_date,
        b.total_price,
        b.status,
        p.payment_id,
        p.amount,
        p.method,
        p.payment_date,
        p.refunded_amount,
        p.refund_status,
        s.title,
        s.location,
        s.size
      FROM bookings b
      LEFT JOIN payments p ON p.booking_id = b.booking_id
      LEFT JOIN storage_spaces s ON s.storage_id = b.storage_id
      LEFT JOIN users u ON u.user_id = b.user_id
      ORDER BY b.booking_id DESC
    `;
    db.query(sql, callback);
  },

  /**
   * Admin: refund a payment (partial or full).
   */
  refundPayment: ({ paymentId, adminUserId, amount, reason }, callback) => {
    const loadSql = `
      SELECT payment_id, amount, refunded_amount
      FROM payments
      WHERE payment_id = ?
      LIMIT 1
    `;
    db.query(loadSql, [paymentId], (err, rows) => {
      if (err) return callback(err);
      if (!rows || rows.length === 0) return callback(new Error("Payment not found."));

      const p = rows[0];
      const totalAmount = parseFloat(p.amount) || 0;
      const refundedAmount = parseFloat(p.refunded_amount) || 0;
      const remaining = parseFloat((totalAmount - refundedAmount).toFixed(2));
      const reqAmount = parseFloat(amount);

      if (!Number.isFinite(reqAmount) || reqAmount <= 0) {
        return callback(new Error("Refund amount must be greater than 0."));
      }
      if (reqAmount > remaining) {
        return callback(new Error(`Refund amount exceeds remaining balance (${remaining.toFixed(2)}).`));
      }

      const newRefunded = parseFloat((refundedAmount + reqAmount).toFixed(2));
      const isFull = newRefunded >= totalAmount;
      const refundStatus = isFull ? "FULL" : "PARTIAL";

      db.beginTransaction((txErr) => {
        if (txErr) return callback(txErr);

        const refundSql = `
          INSERT INTO payment_refunds (payment_id, amount, reason, created_by_user_id)
          VALUES (?, ?, ?, ?)
        `;
        db.query(refundSql, [paymentId, reqAmount, reason || null, adminUserId || null], (errR) => {
          if (errR) return db.rollback(() => callback(errR));

          const updateSql = `
            UPDATE payments
            SET refunded_amount = ?,
                refund_status = ?
            WHERE payment_id = ?
          `;
          db.query(updateSql, [newRefunded, refundStatus, paymentId], (errU) => {
            if (errU) return db.rollback(() => callback(errU));
            db.commit((errC) => {
              if (errC) return db.rollback(() => callback(errC));
              return callback(null, true);
            });
          });
        });
      });
    });
  }
};
