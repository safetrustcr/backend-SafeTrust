const express = require('express');
const { disputeEscrowHandler } = require('./dispute.handler');

const router = express.Router();
router.post('/api/escrows/dispute', disputeEscrowHandler);

module.exports = router;
