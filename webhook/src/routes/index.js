const express = require('express')
const router = express.Router()

const { authMiddleware, authenticateFirebase } = require('../middleware/auth.middleware')

// Route handlers / routers
const authRoutes = require('./auth')
const bidRequestRoutes = require('./bid-requests')
const reconciliationRoutes = require('./reconciliation/sync-escrows.route')
const apartmentsRoutes = require('./apartments/list.route');
const escrowRoutes = require('./escrows/approve-milestone.route');
const meRoute = require('./auth/me.route');
const disputeRoute = require('./escrows/dispute.route');
const initializeEscrowRoute = require('./escrows/initialize.route');
const fundEscrowRoute = require('./escrows/fund.route');
const releaseFundsRoute = require('./escrows/release-funds.route');
const resolveDisputeRoute = require('./escrows/resolve-dispute.route');

// 1. Health Check
router.get('/health', (req, res) => res.status(200).send('OK'))

// 2. Public Webhooks (Must be registered before the auth middlewares)
router.use(disputeRoute)
router.use(initializeEscrowRoute)
router.use(fundEscrowRoute)
router.use(releaseFundsRoute)
router.use(resolveDisputeRoute)
router.use(escrowRoutes)

// 3. Authenticated Routes & Auth Middlewares
router.use('/api', authMiddleware)
router.use('/api', authenticateFirebase)
router.use('/api/auth', authRoutes)
router.use(meRoute);
router.use('/api/apartments', apartmentsRoutes);
router.use('/api/bid-requests', bidRequestRoutes)
router.use('/api/reconciliation', reconciliationRoutes)

module.exports = router

