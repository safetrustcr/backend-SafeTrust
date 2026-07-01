const express = require('express')
const router = express.Router()

const { authenticateFirebase } = require('../middleware/auth')

const authRoutes = require('./auth')
const bidRequestRoutes = require('./bid-requests')
const reconciliationRoutes = require('./reconciliation')
const apartmentsRoutes = require('./apartments/list.route');
const meRoute = require('./auth/me.route');
const disputeRoute = require('./escrows/dispute.route');
const initializeEscrowRoute = require('./escrows/initialize.route');

router.get('/health', (req, res) => res.status(200).send('OK'))
router.use(disputeRoute)
router.use(initializeEscrowRoute)
router.use('/api', authenticateFirebase)
router.use('/api/auth', authRoutes)
router.use(meRoute);
router.use('/api/apartments', apartmentsRoutes);
router.use('/api/bid-requests', bidRequestRoutes)
router.use('/api/reconciliation', reconciliationRoutes)

module.exports = router
