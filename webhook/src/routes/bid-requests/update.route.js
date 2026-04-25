const express = require('express')
const { updateBidRequestHandler } = require('./update.handler')

const router = express.Router()

router.patch('/:id', updateBidRequestHandler)

module.exports = router

