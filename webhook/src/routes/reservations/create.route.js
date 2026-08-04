const express = require('express');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { createReservationHandler } = require('./create.handler');

const router = express.Router();

// authMiddleware required — guest must be authenticated to book
router.post('/api/reservations', authMiddleware, createReservationHandler);

module.exports = router;