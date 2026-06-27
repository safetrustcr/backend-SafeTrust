const express = require('express')
const router = express.Router()

const { authenticateFirebase } = require('../middleware/auth.middleware')

const authRoutes = require('./auth')
const bidRequestRoutes = require('./bid-requests')
const reconciliationRoutes = require('./reconciliation')
const apartmentsRoutes = require('./apartments/list.route');
const releaseFundsRoute = require('./escrows/release-funds.route');

router.get('/health', (req, res) => res.status(200).send('OK'))
router.use(releaseFundsRoute)
router.use('/api', authenticateFirebase)
router.use('/api/auth', authRoutes)
router.use('/api/apartments', apartmentsRoutes);
router.use('/api/bid-requests', bidRequestRoutes)
router.use('/api/reconciliation', reconciliationRoutes)

module.exports = router
