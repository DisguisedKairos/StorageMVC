const User = require("../models/User");
const LoyaltyPoints = require("../models/LoyaltyPoints");

function requireCustomer(req, res) {
  if (!req.session.user) return true;
  if (req.session.user.role !== "customer") {
    res.status(403).send("Not authorized");
    return true;
  }
  return false;
}

module.exports = {
  /**
   * GET /loyalty/dashboard - View loyalty points dashboard
   */
  dashboard: (req, res) => {
    if (requireCustomer(req, res)) return;

    const userId = req.session.user.id;

    LoyaltyPoints.getUserPoints(userId, (err, tierRows) => {
      if (err) {
        console.error("Error fetching user points:", err);
        return res.status(500).render("error", { message: "Could not load loyalty points" });
      }

      const userInfo = tierRows && tierRows[0] ? tierRows[0] : {
        loyalty_points: 0,
        lifetime_points: 0,
        tier_name: "Bronze",
        earn_rate: 1.0,
        redeem_rate: 1.0
      };

      LoyaltyPoints.getPointsToNextTier(userId, (errTier, nextTierRows) => {
        const nextTierInfo = nextTierRows && nextTierRows[0] ? nextTierRows[0] : {
          points_needed: 500,
          next_tier: "Silver"
        };

        LoyaltyPoints.getUserTransactions(userId, 50, (errTx, transactions) => {
          if (errTx) transactions = [];

          const formattedTransactions = (transactions || []).map((tx) => {
            const date = new Date(tx.created_at);
            const sgtDateTime = date.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
            return {
              ...tx,
              created_at_display: sgtDateTime
            };
          });

          LoyaltyPoints.getAllTiers((errAllTiers, allTiers) => {
            const tiers = allTiers || [];

            res.render("loyalty_dashboard", {
              user: req.session.user,
              loyalty_points: userInfo.loyalty_points,
              lifetime_points: userInfo.lifetime_points,
              tier_name: userInfo.tier_name,
              earn_rate: userInfo.earn_rate,
              redeem_rate: userInfo.redeem_rate,
              points_needed: nextTierInfo.points_needed,
              next_tier: nextTierInfo.next_tier,
              transactions: formattedTransactions,
              tiers: tiers
            });
          });
        });
      });
    });
  },

  /**
   * GET /loyalty/redeem - Show redemption page
   */
  showRedeemPage: (req, res) => {
    if (requireCustomer(req, res)) return;

    const userId = req.session.user.id;

    LoyaltyPoints.getUserPoints(userId, (err, tierRows) => {
      if (err) {
        return res.status(500).render("error", { message: "Could not load loyalty points" });
      }

      const userInfo = tierRows && tierRows[0] ? tierRows[0] : {
        loyalty_points: 0,
        redeem_rate: 1.0
      };

      res.render("loyalty_redeem", {
        user: req.session.user,
        loyalty_points: userInfo.loyalty_points,
        redeem_rate: userInfo.redeem_rate,
        // Show points in increments of 100
        redeemOptions: [
          { points: 100, value: (100 / 100) * userInfo.redeem_rate },
          { points: 250, value: (250 / 100) * userInfo.redeem_rate },
          { points: 500, value: (500 / 100) * userInfo.redeem_rate },
          { points: 1000, value: (1000 / 100) * userInfo.redeem_rate }
        ].filter(opt => opt.points <= userInfo.loyalty_points)
      });
    });
  },

  /**
   * POST /api/loyalty/redeem - Redeem points for discount (for checkout)
   */
  redeemPointsApi: (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
    if (req.session.user.role !== "customer") {
      return res.status(403).json({ error: "Not authorized" });
    }

    const userId = req.session.user.id;
    const { points } = req.body;

    if (!points || points < 100) {
      return res.status(400).json({ error: "Minimum 100 points required" });
    }

    LoyaltyPoints.redeemPoints(userId, points, `CHECKOUT-${Date.now()}`, (err, result) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      // Store redemption in session for checkout
      if (!req.session.checkout) {
        req.session.checkout = {};
      }
      req.session.checkout.loyaltyRedemption = {
        points: points,
        discount: result.discountAmount
      };

      res.json({
        success: true,
        points: points,
        discount: result.discountAmount,
        message: `${points} points redeemed for $${result.discountAmount.toFixed(2)} discount`
      });
    });
  },

  /**
   * GET /api/loyalty/info - Get user's loyalty info (for AJAX)
   */
  getInfoApi: (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Not logged in" });

    const userId = req.session.user.id;

    LoyaltyPoints.getUserPoints(userId, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Could not fetch loyalty info" });
      }

      const info = rows && rows[0] ? rows[0] : {
        loyalty_points: 0,
        lifetime_points: 0,
        tier_name: "Bronze",
        earn_rate: 1.0,
        redeem_rate: 1.0
      };

      res.json(info);
    });
  },

  /**
   * POST /api/loyalty/calculate-reward - Calculate points for amount (for preview)
   */
  calculateReward: (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Not logged in" });

    const userId = req.session.user.id;
    const { amount } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    LoyaltyPoints.getUserPoints(userId, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Could not fetch loyalty info" });
      }

      const userInfo = rows && rows[0] ? rows[0] : {
        tier_name: "Bronze",
        earn_rate: 1.0,
        bonus_multiplier: 1.0
      };

      const pointsEarned = Math.floor(amount * userInfo.earn_rate * (userInfo.bonus_multiplier || 1.0));

      res.json({
        amount: amount,
        points_earned: pointsEarned,
        tier: userInfo.tier_name,
        earn_rate: userInfo.earn_rate,
        message: `You'll earn ${pointsEarned} points on this $${parseFloat(amount).toFixed(2)} purchase`
      });
    });
  }
};
