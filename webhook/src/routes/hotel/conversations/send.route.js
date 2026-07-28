'use strict';

const express = require('express');
const { sendHotelConversationHandler } = require('./send.handler');

const router = express.Router();

// Internal/service route — called by escrow handlers and clients.
// Registered before Firebase auth (see routes/index.js).
router.post('/api/hotel/conversations/send', sendHotelConversationHandler);

module.exports = router;
