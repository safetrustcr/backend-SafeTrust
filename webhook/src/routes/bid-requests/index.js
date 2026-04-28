const express = require('express')
const updateRoute = require('./update.route')

/** Aggregates bid-request sub-routes. */
const router = express.Router()

router.use('/', updateRoute)

module.exports = router

