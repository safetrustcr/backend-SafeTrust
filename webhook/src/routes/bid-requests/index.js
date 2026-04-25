const express = require('express')
const updateRoute = require('./update.route')

const router = express.Router()

router.use('/', updateRoute)

module.exports = router

