const express = require('express');
const syncEscrowsRoute = require('./sync-escrows.route');

const router = express.Router();
router.use('/', syncEscrowsRoute);

module.exports = router;
