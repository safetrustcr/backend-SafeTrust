const express = require('express')
const { updateBidRequestHandler } = require('./update.handler')

/** Express router for PATCH /api/bid-requests/:id (mounted under /api/bid-requests). */
const router = express.Router()

router.patch('/:id', updateBidRequestHandler)

module.exports = router

