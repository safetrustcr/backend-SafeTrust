const express = require('express');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { meHandler } = require('./me.handler');

const router = express.Router();

router.get('/api/auth/me', authMiddleware, meHandler);

module.exports = router;
