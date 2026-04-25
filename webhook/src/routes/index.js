const express = require('express')
const router = express.Router()

const { authenticateFirebase } = require('../middleware/auth')

const authRoutes = require('./auth')
const apartmentRoutes = require('./apartments')
const bidRequestRoutes = require('./bid-requests')

router.get('/health', (req, res) => res.status(200).send('OK'))

router.use('/api', authenticateFirebase)
router.use('/api/auth', authRoutes)
router.use('/api/apartments', apartmentRoutes)
router.use('/api/bid-requests', bidRequestRoutes)

module.exports = router
