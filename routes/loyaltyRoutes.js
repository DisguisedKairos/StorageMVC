const express = require('express');
const router = express.Router();
const loyaltyController = require('../controllers/loyaltyController');

// Loyalty dashboard and info
router.get('/dashboard', loyaltyController.dashboard);
router.get('/redeem', loyaltyController.showRedeemPage);

// API endpoints
router.post('/api/redeem', loyaltyController.redeemPointsApi);
router.get('/api/info', loyaltyController.getInfoApi);
router.post('/api/calculate-reward', loyaltyController.calculateReward);

module.exports = router;
