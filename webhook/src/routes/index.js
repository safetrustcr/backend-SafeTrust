const express = require('express')
const router = express.Router()

/**
 * Root router: health, webhooks, then Firebase-protected `/api/*` routes.
 */
const { authenticateFirebase } = require('../middleware/auth')

const authRoutes = require('./auth')
const apartmentRoutes = require('./apartments')
const bidRequestRoutes = require('./bid-requests')
const escrowRoutes = require('./escrow')

router.get('/health', (req, res) => res.status(200).send('OK'))

// Webhook routes — no auth required (called by external services)
router.use('/webhooks', escrowRoutes)

// API routes — Firebase auth required
router.use('/api', authenticateFirebase)
router.use('/api/auth', authRoutes)
router.use('/api/apartments', apartmentRoutes)
router.use('/api/bid-requests', bidRequestRoutes)

module.exports = router
