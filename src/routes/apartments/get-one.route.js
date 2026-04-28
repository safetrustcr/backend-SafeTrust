const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { getApartmentHandler } = require('./get-one.handler');

const router = express.Router();

router.get('/:id', requireAuth, getApartmentHandler);

module.exports = router;
