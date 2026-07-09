const express = require('express');
const { releaseFundsHandler } = require('./release-funds.handler');

const router = express.Router();
router.post('/api/escrows/release-funds', releaseFundsHandler);

module.exports = router;
