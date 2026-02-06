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
          INSERT INTO bookings (user_id, storage_id, quantity, start_date, end_date, total_price, status)
          VALUES (?, ?, ?, ?, ?, ?, 'Paid')
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
            [userId, it.storage_id, it.quantity, startDate, endDate, it.subtotal],
            (bErr, bRes) => {
              if (bErr) return db.rollback(() => callback(bErr));
              const bookingId = bRes.insertId;

              const paymentSql = `
                INSERT INTO payments (booking_id, amount, method, payment_date)
                VALUES (?, ?, ?, NOW())
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
   * Create a PENDING invoice for online payment flows (NETS/PayPal/Stripe).
   * This stores a snapshot of cart items + booking dates in invoice tables.
   */
  createPendingFromCart: (userId, startDate, endDate, paymentMethod, callback) => {
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
      const tax = 0;
      const totalAmount = subtotal + tax;
      const invoiceRef = "INV-" + Date.now();

      db.beginTransaction((txErr) => {
        if (txErr) return callback(txErr);

        const headerSql = `
          INSERT INTO invoice (user_id, invoice_ref, subtotal, tax, total_amount, start_date, end_date, days, status, payment_method, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_PAYMENT', ?, NOW())
        `;
        db.query(
          headerSql,
          [userId, invoiceRef, subtotal, tax, totalAmount, startDate, endDate, days, paymentMethod],
          (errH, resultH) => {
            if (errH) return db.rollback(() => callback(errH));
            const invoiceId = resultH.insertId;

            const itemSql = `
              INSERT INTO invoice_items
                (invoice_id, storage_id, title, location, size, quantity, unit_price, days, start_date, end_date, subtotal)
              VALUES ?
            `;
            const values = lineItems.map((it) => [
              invoiceId,
              it.storage_id,
              it.title,
              it.location,
              it.size,
              it.quantity,
              it.unit_price,
              it.days,
              it.start_date,
              it.end_date,
              it.subtotal,
            ]);

            db.query(itemSql, [values], (errI) => {
              if (errI) return db.rollback(() => callback(errI));
              db.commit((errC) => {
                if (errC) return db.rollback(() => callback(errC));
                return callback(null, {
                  header: {
                    id: invoiceId,
                    invoiceRef,
                    startDate,
                    endDate,
                    days,
                    subtotal,
                    tax,
                    totalAmount,
                    paymentMethod,
                    status: "PENDING_PAYMENT",
                  },
                  items: lineItems,
                });
              });
            });
          }
        );
      });
    });
  },

  /**
   * Finalize a pending invoice: create bookings + payments, clear cart, mark invoice paid.
   */
  markPaid: ({ invoiceId, userId, paymentMethod, provider, providerRef }, callback) => {
    db.beginTransaction((txErr) => {
      if (txErr) return callback(txErr);

      const loadSql = `
        SELECT
          i.user_id,
          i.start_date,
          i.end_date,
          i.days
        FROM invoice i
        WHERE i.id = ? AND i.user_id = ?
        LIMIT 1
      `;
      db.query(loadSql, [invoiceId, userId], (errInv, invRows) => {
        if (errInv) return db.rollback(() => callback(errInv));
        if (!invRows || invRows.length === 0) {
          return db.rollback(() => callback(new Error("Invoice not found")));
        }

        const itemsSql = `
          SELECT
            id,
            storage_id,
            quantity,
            unit_price,
            subtotal,
            start_date,
            end_date
          FROM invoice_items
          WHERE invoice_id = ?
        `;
        db.query(itemsSql, [invoiceId], (errItems, items) => {
          if (errItems) return db.rollback(() => callback(errItems));
          if (!items || items.length === 0) {
            return db.rollback(() => callback(new Error("Invoice items not found")));
          }

          const bookingSql = `
            INSERT INTO bookings (user_id, storage_id, quantity, start_date, end_date, total_price, status)
            VALUES (?, ?, ?, ?, ?, ?, 'Paid')
          `;
          const paymentSql = `
            INSERT INTO payments (booking_id, amount, method, payment_date)
            VALUES (?, ?, ?, NOW())
          `;

          let i = 0;
          const createNext = () => {
            if (i >= items.length) return finalizeInvoice();
            const it = items[i++];
            db.query(
              bookingSql,
              [userId, it.storage_id, it.quantity, it.start_date, it.end_date, it.subtotal],
              (bErr, bRes) => {
                if (bErr) return db.rollback(() => callback(bErr));
                const bookingId = bRes.insertId;

                db.query(paymentSql, [bookingId, it.subtotal, paymentMethod], (pErr) => {
                  if (pErr) return db.rollback(() => callback(pErr));
                  db.query(
                    "UPDATE invoice_items SET booking_id = ? WHERE id = ?",
                    [bookingId, it.id],
                    (uErr) => {
                      if (uErr) return db.rollback(() => callback(uErr));
                      return createNext();
                    }
                  );
                });
              }
            );
          };

          const finalizeInvoice = () => {
            const updSql = `
              UPDATE invoice
              SET status='PAID',
                  payment_method = ?,
                  provider = ?,
                  provider_ref = ?,
                  paid_at = NOW()
              WHERE id = ? AND user_id = ?
            `;
            db.query(updSql, [paymentMethod, provider || null, providerRef || null, invoiceId, userId], (uErr) => {
              if (uErr) return db.rollback(() => callback(uErr));
              db.query("DELETE FROM cart_items WHERE user_id = ?", [userId], (cErr) => {
                if (cErr) return db.rollback(() => callback(cErr));
                db.commit((cmtErr) => {
                  if (cmtErr) return db.rollback(() => callback(cmtErr));
                  return callback(null, true);
                });
              });
            });
          };

          createNext();
        });
      });
    });
  },

  updateProviderMeta: ({ invoiceId, userId, provider, providerRef }, callback) => {
    const sql = `
      UPDATE invoice
      SET provider = ?, provider_ref = ?
      WHERE id = ? AND user_id = ?
    `;
    db.query(sql, [provider || null, providerRef || null, invoiceId, userId], (err) => {
      if (err) return callback(err);
      return callback(null, true);
    });
  },

  findByProviderRef: (provider, providerRef, callback) => {
    const sql = `
      SELECT id, user_id, status, payment_method, provider, provider_ref
      FROM invoice
      WHERE provider = ? AND provider_ref = ?
      LIMIT 1
    `;
    db.query(sql, [provider, providerRef], (err, rows) => {
      if (err) return callback(err);
      if (!rows || rows.length === 0) return callback(new Error("Invoice not found"));
      return callback(null, rows[0]);
    });
  },

  getStatus: (invoiceId, userId, callback) => {
    const sql = `
      SELECT id, status, payment_method, provider, provider_ref, paid_at
      FROM invoice
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `;
    db.query(sql, [invoiceId, userId], (err, rows) => {
      if (err) return callback(err);
      if (!rows || rows.length === 0) return callback(new Error("Invoice not found"));
      return callback(null, rows[0]);
    });
  },

  getById: (invoiceId, userId, callback) => {
    const headerSql = `
      SELECT id, user_id, invoice_ref, subtotal, tax, total_amount, start_date, end_date, days, status, payment_method, provider, provider_ref, paid_at
      FROM invoice
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `;
    db.query(headerSql, [invoiceId, userId], (err, rows) => {
      if (err) return callback(err);
      if (!rows || rows.length === 0) return callback(new Error("Invoice not found"));
      const header = rows[0];

      const itemsSql = `
        SELECT booking_id, storage_id, title, location, size, quantity, unit_price, days, subtotal
        FROM invoice_items
        WHERE invoice_id = ?
      `;
      db.query(itemsSql, [invoiceId], (errI, items) => {
        if (errI) return callback(errI);
        return callback(null, { header, items: items || [] });
      });
    });
  },

  /**
   * Fallback: build an invoice view from a booking id.
   * This supports StorageMVC's booking-based flow.
   */
  getByBookingId: (bookingId, userId, callback) => {
    const sql = `
      SELECT
        b.booking_id,
        b.user_id,
        b.storage_id,
        b.start_date,
        b.end_date,
        b.total_price,
        b.status,
        p.payment_id,
        p.method AS payment_method,
        p.payment_date,
        s.title,
        s.location,
        s.size
      FROM bookings b
      LEFT JOIN payments p ON p.booking_id = b.booking_id
      LEFT JOIN storage_spaces s ON s.storage_id = b.storage_id
      WHERE b.booking_id = ? AND b.user_id = ?
      LIMIT 1
    `;

    db.query(sql, [bookingId, userId], (err, rows) => {
      if (err) return callback(err);
      if (!rows || rows.length === 0) return callback(new Error("Booking not found"));

      const row = rows[0];
      const startDate = row.start_date;
      const endDate = row.end_date;
      const days = daysBetweenInclusive(
        startDate && startDate.toISOString ? startDate.toISOString().slice(0, 10) : startDate,
        endDate && endDate.toISOString ? endDate.toISOString().slice(0, 10) : endDate
      ) || 0;

      const header = {
        invoiceRef: `BOOKING-${row.booking_id}`,
        startDate,
        endDate,
        days,
        subtotal: Number(row.total_price) || 0,
        tax: 0,
        totalAmount: Number(row.total_price) || 0,
        paymentMethod: row.payment_method || "N/A",
        status: row.status || "Pending",
        paymentRef: row.payment_id ? `PAY-${row.payment_id}` : null,
        paymentDate: row.payment_date || null
      };

      const items = [
        {
          booking_id: row.booking_id,
          storage_id: row.storage_id,
          title: row.title,
          location: row.location,
          size: row.size,
          quantity: 1,
          unit_price: Number(row.total_price) || 0,
          days,
          subtotal: Number(row.total_price) || 0
        }
      ];

      return callback(null, { header, items });
    });
  },

  resetPendingPayment: ({ invoiceId, userId }, callback) => {
    const sql = `
      UPDATE invoice
      SET status='PENDING_PAYMENT',
          provider = NULL,
          provider_ref = NULL,
          paid_at = NULL
      WHERE id = ? AND user_id = ?
    `;
    db.query(sql, [invoiceId, userId], (err) => {
      if (err) return callback(err);
      return callback(null, true);
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
   * List NETS invoice records for the current user.
   */
  listInvoicesByUser: (userId, callback) => {
    const sql = `
      SELECT
        id,
        invoice_ref,
        start_date,
        end_date,
        days,
        subtotal,
        tax,
        total_amount,
        status,
        payment_method,
        provider,
        provider_ref,
        created_at,
        paid_at
      FROM invoice
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
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
