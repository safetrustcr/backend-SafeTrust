const express = require('express');
const syncWalletRoute = require('./sync-wallet.route');
const syncUserRoute = require('./sync-user.route');

const router = express.Router();
router.use('/', syncWalletRoute);
router.use('/', syncUserRoute);

module.exports = router;
