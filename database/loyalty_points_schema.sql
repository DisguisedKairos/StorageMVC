-- Loyalty Points System Schema
-- Add loyalty points tracking to users and transactions

-- 1) Add loyalty points columns to users table
ALTER TABLE users
  ADD COLUMN loyalty_points INT NOT NULL DEFAULT 0 AFTER wallet_balance,
  ADD COLUMN lifetime_points INT NOT NULL DEFAULT 0 AFTER loyalty_points,
  ADD INDEX idx_loyalty_points (loyalty_points);

-- 2) Create loyalty points transaction history
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  loyalty_txn_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  points INT NOT NULL,
  transaction_type VARCHAR(20) NOT NULL COMMENT 'EARNED, REDEEMED, EXPIRED, BONUS',
  reference_id VARCHAR(100) NULL COMMENT 'booking_id, invoice_id, etc.',
  description VARCHAR(255) NULL,
  expiry_date DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_loyalty_txn_user (user_id),
  KEY idx_loyalty_txn_type (transaction_type),
  KEY idx_loyalty_txn_created (created_at)
);

-- 3) Loyalty tier settings (reference table)
CREATE TABLE IF NOT EXISTS loyalty_tiers (
  tier_id INT AUTO_INCREMENT PRIMARY KEY,
  tier_name VARCHAR(50) NOT NULL UNIQUE,
  min_points INT NOT NULL,
  max_points INT NULL,
  earn_rate DECIMAL(3,2) NOT NULL COMMENT 'points per $1 spent',
  redeem_rate DECIMAL(3,2) NOT NULL COMMENT 'discount $ per 100 points',
  bonus_multiplier DECIMAL(3,2) NOT NULL DEFAULT 1.0,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4) Insert default tiers
INSERT INTO loyalty_tiers (tier_name, min_points, max_points, earn_rate, redeem_rate, bonus_multiplier, description) VALUES
('Bronze', 0, 499, 1.0, 1.0, 1.0, 'Basic tier - 1 point per $1 spent'),
('Silver', 500, 1999, 1.5, 1.2, 1.2, 'Mid tier - 1.5 points per $1 spent, 20% better redeem rate'),
('Gold', 2000, NULL, 2.0, 1.5, 1.5, 'Elite tier - 2 points per $1 spent, 50% better redeem rate');

-- 5) Booking points mapping (to track which bookings gave points)
CREATE TABLE IF NOT EXISTS booking_loyalty (
  booking_loyalty_id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  user_id INT NOT NULL,
  points_earned INT NOT NULL,
  redemption_amount DECIMAL(10,2) NULL COMMENT 'if points were redeemed for discount',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_booking_loyalty (booking_id, user_id)
);

-- 6) Create indexes for better query performance
CREATE INDEX idx_loyalty_tier_points ON loyalty_tiers (min_points, max_points);
CREATE INDEX idx_booking_loyalty_user ON booking_loyalty (user_id);
