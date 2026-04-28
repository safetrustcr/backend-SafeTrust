const express = require('express')
const router = express.Router()

/**
 * Root router: health, then Firebase-protected `/api/*` routes.
 */
const { authenticateFirebase } = require('../middleware/auth')

const authRoutes = require('./auth')
const apartmentRoutes = require('./apartments')
const bidRequestRoutes = require('./bid-requests')
// In a real app, these would be imported from separate files:
// const apartmentRoutes = require('./apartment.routes');
// ...
const apartmentRoutes = placeholder('Apartments');
const bidRoutes = require('./bid-requests/create.route');
const escrowRoutes = placeholder('Escrow');
const userRoutes = placeholder('Users');
const healthRoute = (req, res) => res.status(200).send('OK');
const webhookRoutes = (req, res) => res.status(200).json({ status: 'received' });

router.get('/health', (req, res) => res.status(200).send('OK'))

router.use('/api', authenticateFirebase)
router.use('/api/auth', authRoutes)
router.use('/api/apartments', apartmentRoutes)
router.use('/api/bid-requests', bidRequestRoutes)

module.exports = router
