const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { initializeEscrowHandler } = require('./initialize.handler');

const router = express.Router();

router.post('/', requireAuth, initializeEscrowHandler);

module.exports = router;
