const express = require('express');
const router = express.Router();
const { createBidRequestHandler } = require('./create.handler');

router.post('/', createBidRequestHandler);

module.exports = router;
