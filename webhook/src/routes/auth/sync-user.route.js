const express = require('express');
const { syncUserHandler } = require('./sync-user.handler');

const router = express.Router();
router.post('/sync-user', syncUserHandler);

module.exports = router;
