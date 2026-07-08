const express = require('express')
const updateRoute = require('./update.route')
const createRoute = require('./create.route')

const router = express.Router()

router.use('/', updateRoute)
router.use('/', createRoute)

module.exports = router

