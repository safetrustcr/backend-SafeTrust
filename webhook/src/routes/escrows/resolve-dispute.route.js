const express = require('express');
const { resolveDisputeHandler } = require('./resolve-dispute.handler');

const router = express.Router();

// No authMiddleware — this is a TrustlessWork callback
router.post('/api/escrows/resolve-dispute', resolveDisputeHandler);

module.exports = router;
