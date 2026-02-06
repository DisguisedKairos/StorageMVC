const db = require("../config/db");

module.exports = {
  /**
   * Get user's current loyalty points and tier
   */
  getUserPoints: (userId, callback) => {
    db.query(
      `SELECT 
        u.loyalty_points,
        u.lifetime_points,
        lt.tier_name,
        lt.earn_rate,
        lt.redeem_rate,
        lt.bonus_multiplier
      FROM users u
      LEFT JOIN loyalty_tiers lt ON u.loyalty_points >= lt.min_points 
        AND (lt.max_points IS NULL OR u.loyalty_points <= lt.max_points)
      WHERE u.user_id = ?`,
      [userId],
      callback
    );
  },

  /**
   * Award loyalty points for a payment/booking
   * @param {number} userId
   * @param {number} amount - Amount paid in dollars
   * @param {string} referenceId - booking_id or invoice_id
   * @param {string} description - Description of the transaction
   * @param {function} callback
   */
  awardPoints: (userId, amount, referenceId, description, callback) => {
    // Get user's earn rate based on tier
    db.query(
      `SELECT lt.earn_rate, lt.bonus_multiplier
       FROM users u
       LEFT JOIN loyalty_tiers lt ON u.loyalty_points >= lt.min_points 
         AND (lt.max_points IS NULL OR u.loyalty_points <= lt.max_points)
       WHERE u.user_id = ?`,
      [userId],
      (err, rows) => {
        if (err) return callback(err);

        const earnRate = (rows && rows[0] && rows[0].earn_rate) || 1.0;
        const bonusMultiplier = (rows && rows[0] && rows[0].bonus_multiplier) || 1.0;
        const pointsEarned = Math.floor(amount * earnRate * bonusMultiplier);

        // Award points to user
        db.query(
          `UPDATE users SET 
            loyalty_points = loyalty_points + ?,
            lifetime_points = lifetime_points + ?
           WHERE user_id = ?`,
          [pointsEarned, pointsEarned, userId],
          (updateErr) => {
            if (updateErr) return callback(updateErr);

            // Log transaction
            db.query(
              `INSERT INTO loyalty_transactions (user_id, points, transaction_type, reference_id, description)
               VALUES (?, ?, 'EARNED', ?, ?)`,
              [userId, pointsEarned, referenceId, description],
              (insertErr) => {
                if (insertErr) return callback(insertErr);
                callback(null, { pointsEarned, earnRate, bonusMultiplier });
              }
            );
          }
        );
      }
    );
  },

  /**
   * Redeem loyalty points for discount
   * @param {number} userId
   * @param {number} pointsToRedeem
   * @param {string} referenceId - booking_id or invoice_id
   * @param {function} callback
   */
  redeemPoints: (userId, pointsToRedeem, referenceId, callback) => {
    // Validate user has enough points
    db.query(
      `SELECT u.loyalty_points, lt.redeem_rate
       FROM users u
       LEFT JOIN loyalty_tiers lt ON u.loyalty_points >= lt.min_points 
         AND (lt.max_points IS NULL OR u.loyalty_points <= lt.max_points)
       WHERE u.user_id = ?`,
      [userId],
      (err, rows) => {
        if (err) return callback(err);
        if (!rows || rows.length === 0) {
          return callback(new Error("User not found"));
        }

        const currentPoints = rows[0].loyalty_points || 0;
        const redeemRate = (rows[0].redeem_rate || 1.0);

        if (pointsToRedeem > currentPoints) {
          return callback(new Error("Insufficient loyalty points"));
        }

        // Calculate discount amount: 100 points = $redeemRate
        const discountAmount = (pointsToRedeem / 100) * redeemRate;

        // Deduct points
        db.query(
          `UPDATE users SET loyalty_points = loyalty_points - ? WHERE user_id = ?`,
          [pointsToRedeem, userId],
          (updateErr) => {
            if (updateErr) return callback(updateErr);

            // Log redemption transaction
            db.query(
              `INSERT INTO loyalty_transactions (user_id, points, transaction_type, reference_id, description)
               VALUES (?, ?, 'REDEEMED', ?, ?)`,
              [userId, -pointsToRedeem, referenceId, `Redeemed for $${discountAmount.toFixed(2)} discount`],
              (insertErr) => {
                if (insertErr) return callback(insertErr);
                callback(null, { 
                  discountAmount: parseFloat(discountAmount.toFixed(2)), 
                  pointsRedeemed: pointsToRedeem 
                });
              }
            );
          }
        );
      }
    );
  },

  /**
   * Get loyalty transactions for a user
   */
  getUserTransactions: (userId, limit = 20, callback) => {
    db.query(
      `SELECT * FROM loyalty_transactions
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, limit],
      callback
    );
  },

  /**
   * Get all loyalty tiers
   */
  getAllTiers: (callback) => {
    db.query(
      `SELECT * FROM loyalty_tiers ORDER BY min_points ASC`,
      callback
    );
  },

  /**
   * Get points to next tier
   */
  getPointsToNextTier: (userId, callback) => {
    db.query(
      `SELECT 
        u.loyalty_points,
        current_tier.tier_name AS current_tier,
        current_tier.min_points AS current_tier_min,
        next_tier.tier_name AS next_tier,
        next_tier.min_points AS next_tier_min,
        CASE 
          WHEN next_tier.min_points IS NULL THEN 0
          ELSE next_tier.min_points - u.loyalty_points
        END AS points_needed
       FROM users u
       LEFT JOIN loyalty_tiers current_tier ON u.loyalty_points >= current_tier.min_points 
         AND (current_tier.max_points IS NULL OR u.loyalty_points <= current_tier.max_points)
       LEFT JOIN loyalty_tiers next_tier ON next_tier.min_points > u.loyalty_points
       WHERE u.user_id = ?
       ORDER BY next_tier.min_points ASC
       LIMIT 1`,
      [userId],
      callback
    );
  },

  /**
   * Award bonus points (admin feature)
   */
  awardBonusPoints: (userId, points, reason, callback) => {
    db.query(
      `UPDATE users SET 
        loyalty_points = loyalty_points + ?,
        lifetime_points = lifetime_points + ?
       WHERE user_id = ?`,
      [points, points, userId],
      (updateErr) => {
        if (updateErr) return callback(updateErr);

        db.query(
          `INSERT INTO loyalty_transactions (user_id, points, transaction_type, description)
           VALUES (?, ?, 'BONUS', ?)`,
          [userId, points, reason],
          callback
        );
      }
    );
  },

  /**
   * Get loyalty tier by points
   */
  getTierByPoints: (points, callback) => {
    db.query(
      `SELECT * FROM loyalty_tiers
       WHERE ? >= min_points AND (max_points IS NULL OR ? <= max_points)`,
      [points, points],
      callback
    );
  }
};
