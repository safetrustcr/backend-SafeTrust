const express = require('express')
const router = express.Router()

const { authMiddleware, authenticateFirebase } = require('../middleware/auth.middleware')

const authRoutes = require('./auth/sync-wallet.route')
const bidRequestRoutes = require('./bid-requests')
const reconciliationRoutes = require('./reconciliation/sync-escrows.route')
const apartmentsRoutes = require('./apartments/list.route');
const escrowRoutes = require('./escrows/approve-milestone.route');

router.get('/health', (req, res) => res.status(200).send('OK'))
router.use('/api/escrows', authMiddleware, escrowRoutes)
router.use('/api', authMiddleware)
const meRoute = require('./auth/me.route');
const disputeRoute = require('./escrows/dispute.route');
const initializeEscrowRoute = require('./escrows/initialize.route');
const releaseFundsRoute = require('./escrows/release-funds.route');

router.get('/health', (req, res) => res.status(200).send('OK'))
router.use(disputeRoute)
router.use(initializeEscrowRoute)
router.use(releaseFundsRoute)
router.use('/api', authenticateFirebase)
router.use('/api/auth', authRoutes)
router.use(meRoute);
router.use('/api/apartments', apartmentsRoutes);
router.use('/api/bid-requests', bidRequestRoutes)
router.use('/api/reconciliation', reconciliationRoutes)

module.exports = router
