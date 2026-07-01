const express = require('express');
const { fundEscrowHandler } = require('./fund.handler');

const router = express.Router();

// No authMiddleware — this is a TrustlessWork callback, not a user request
router.post('/api/escrows/fund', fundEscrowHandler);

module.exports = router;
