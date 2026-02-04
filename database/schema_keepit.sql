-- KeepIt extension schema (run after your existing schema)
-- Adds provider marketplace features: provider listings, KYC, reviews, and mapping fields.

-- 1) Storage provider fields + map fields
ALTER TABLE storage_spaces
  ADD COLUMN provider_id INT NULL AFTER storage_id,
  ADD COLUMN storage_type VARCHAR(20) NOT NULL DEFAULT 'physical' AFTER provider_id,
  ADD COLUMN latitude DECIMAL(10,7) NULL AFTER location,
  ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude;

-- Optional FK (only if you have users table with user_id PK)
-- ALTER TABLE storage_spaces
--   ADD CONSTRAINT fk_storage_provider FOREIGN KEY (provider_id) REFERENCES users(user_id);

-- 2) Reviews
CREATE TABLE IF NOT EXISTS reviews (
  review_id INT AUTO_INCREMENT PRIMARY KEY,
  storage_id INT NOT NULL,
  user_id INT NOT NULL,
  rating TINYINT NOT NULL,
  comment TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_reviews_storage (storage_id),
  KEY idx_reviews_user (user_id)
);

-- 3) KYC Requests (one row per provider; uses UNIQUE(user_id))
CREATE TABLE IF NOT EXISTS kyc_requests (
  kyc_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  full_name VARCHAR(255) NOT NULL,
  id_type VARCHAR(50) NOT NULL,
  id_number VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  reviewed_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_kyc_status (status)
);

-- 4) If you want to enforce role choices in users table, keep it at app level.

-- 4a) IMPORTANT: Ensure your users.role supports the value 'provider'.
-- If your existing schema uses a short VARCHAR or an ENUM that doesn't include 'provider',
-- registration will fail with: "Data truncated for column 'role'".
-- This statement is safe for most student project schemas (it will widen the column).
ALTER TABLE users
  MODIFY role VARCHAR(20) NOT NULL DEFAULT 'customer';
