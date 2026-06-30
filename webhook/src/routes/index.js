const express = require('express')
const router = express.Router()

const { authenticateFirebase } = require('../middleware/auth')

const authRoutes = require('./auth')
const bidRequestRoutes = require('./bid-requests')
const reconciliationRoutes = require('./reconciliation')
const apartmentsRoutes = require('./apartments/list.route');
const disputeRoute = require('./escrows/dispute.route');
const initializeEscrowRoute = require('./escrows/initialize.route');
const fundEscrowRoute = require('./escrows/fund.route');

router.get('/health', (req, res) => res.status(200).send('OK'))
router.use(disputeRoute)
router.use(initializeEscrowRoute)
router.use(fundEscrowRoute)
router.use('/api', authenticateFirebase)
router.use('/api/auth', authRoutes)
router.use('/api/apartments', apartmentsRoutes);
router.use('/api/bid-requests', bidRequestRoutes)
router.use('/api/reconciliation', reconciliationRoutes)

module.exports = router
