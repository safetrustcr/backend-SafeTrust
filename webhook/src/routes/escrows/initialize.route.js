const express = require('express');
const { initializeEscrowHandler } = require('./initialize.handler');

const router = express.Router();

// No authMiddleware — TrustlessWork is the caller, not a Firebase-authenticated user
router.post('/api/escrows/initialize', initializeEscrowHandler);

module.exports = router;
