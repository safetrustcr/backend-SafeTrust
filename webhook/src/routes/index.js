const express = require('express')
const router = express.Router()

const { authMiddleware } = require('../middleware/auth.middleware')

const authRoutes = require('./auth/sync-wallet.route')
const bidRequestRoutes = require('./bid-requests')
const reconciliationRoutes = require('./reconciliation/sync-escrows.route')
const apartmentsRoutes = require('./apartments/list.route');
const escrowRoutes = require('./escrows/approve-milestone.route');

router.get('/health', (req, res) => res.status(200).send('OK'))
router.use('/api/escrows', escrowRoutes)
router.use('/api', authMiddleware)
router.use('/api/auth', authRoutes)
router.use('/api/apartments', apartmentsRoutes);
router.use('/api/bid-requests', bidRequestRoutes)
router.use('/api/reconciliation', reconciliationRoutes)

module.exports = router
