'use strict';

const express = require('express');
const { syncWalletHandler } = require('./sync-wallet.handler');

const router = express.Router();

router.post('/sync-wallet', syncWalletHandler);

module.exports = router;
