'use strict'

const express = require('express')
const router  = express.Router()
const crypto  = require('crypto')

const verifyTrustlessWorkSignature = require('../middleware/trustlesswork-signature.middleware').default
const { authMiddleware }           = require('../middleware/auth.middleware')

// ── Routes ────────────────────────────────────────────────────────────────────
const initializeRoute       = require('./escrows/initialize.route')
const fundRoute             = require('./escrows/fund.route')
const approveMilestoneRoute = require('./escrows/approve-milestone.route')
const releaseFundsRoute     = require('./escrows/release-funds.route')
const disputeRoute          = require('./escrows/dispute.route')
const resolveDisputeRoute   = require('./escrows/resolve-dispute.route')
const transitionsRoute      = require('./escrow-transitions.route')

const authRoutes              = require('./auth')
const apartmentRoutes         = require('./apartments/list.route')
const bidRequestsRoute        = require('./bid-requests')
const reservationsRoute       = require('./reservations')
const hotelConversationsRoute = require('./hotel/conversations/send.route').default

// ── Service-to-service auth for internal callers (hotel conversations) ────────
function verifyInternalSecret(req, res, next) {
  const token  = req.headers['x-internal-secret']
  const secret = process.env.INTERNAL_SERVICE_SECRET

  if (!secret) {
    console.error('[internal-auth] INTERNAL_SERVICE_SECRET not set')
    return res.status(500).json({ error: 'Internal secret not configured' })
  }

  if (!token) {
    return res.status(401).json({ error: 'Missing x-internal-secret header' })
  }

  const expected = Buffer.from(secret)
  const received = Buffer.from(token)

  if (
    expected.length !== received.length ||
    !crypto.timingSafeEqual(expected, received)
  ) {
    return res.status(401).json({ error: 'Invalid internal secret' })
  }

  next()
}


// ── 1. Health check (public) ──────────────────────────────────────────────────
router.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }))

// ── 2. TrustlessWork webhook callbacks (HMAC verified, no Firebase auth) ──────
router.use('/api/escrows', verifyTrustlessWorkSignature)
router.use(initializeRoute)
router.use(fundRoute)
router.use(approveMilestoneRoute)
router.use(releaseFundsRoute)
router.use(disputeRoute)
router.use(resolveDisputeRoute)
router.use(transitionsRoute)

// ── 3. Hotel conversations (service-to-service auth) ─────────────────────────
router.use('/api/hotel', verifyInternalSecret)
router.use(hotelConversationsRoute)

// ── 4. Authenticated routes (Firebase auth required) ──────────────────────────
router.use('/api', authMiddleware)
router.use('/api/auth',         authRoutes)
router.use('/api/apartments',   apartmentRoutes)
router.use('/api/bid-requests', bidRequestsRoute)
router.use('/api/reservations', reservationsRoute)

module.exports = router