'use strict'

const express = require('express')
const router  = express.Router()

// ── Middleware ────────────────────────────────────────────────────────────────
const verifyTrustlessWorkSignature      = require('../middleware/trustlesswork-signature.middleware')
const { authMiddleware }                = require('../middleware/auth.middleware')

// ── Escrow webhook routes ─────────────────────────────────────────────────────
const initializeRoute       = require('./escrows/initialize.route')
const fundRoute             = require('./escrows/fund.route')
const approveMilestoneRoute = require('./escrows/approve-milestone.route')
const releaseFundsRoute     = require('./escrows/release-funds.route')
const disputeRoute          = require('./escrows/dispute.route')
const resolveDisputeRoute   = require('./escrows/resolve-dispute.route')

// ── Other routes ──────────────────────────────────────────────────────────────
const authRoutes              = require('./auth')
const apartmentRoutes         = require('./apartments/list.route')
const bidRequestsRoute        = require('./bid-requests')
const reservationsRoute       = require('./reservations')
const hotelConversationsRoute = require('./hotel/conversations/send.route')

// ── 1. Health check (public) ──────────────────────────────────────────────────
router.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }))

// ── 2. TrustlessWork webhook callbacks (HMAC verified, no Firebase auth) ──────
// TrustlessWork is the caller — not a Firebase-authenticated user
// verifyTrustlessWorkSignature is exported directly (not as named property)
router.use('/api/escrows', verifyTrustlessWorkSignature)
router.use(initializeRoute)
router.use(fundRoute)
router.use(approveMilestoneRoute)
router.use(releaseFundsRoute)
router.use(disputeRoute)
router.use(resolveDisputeRoute)

// ── 3. Hotel conversations (internal, no TW signature) ────────────────────────
router.use(hotelConversationsRoute)

// ── 4. Authenticated routes (Firebase auth required) ──────────────────────────
router.use('/api', authMiddleware)
router.use('/api/auth',         authRoutes)
router.use('/api/apartments',   apartmentRoutes)
router.use('/api/bid-requests', bidRequestsRoute)
router.use('/api/reservations', reservationsRoute)

module.exports = router