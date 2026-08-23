import express, { Request, Response, NextFunction, RequestHandler } from 'express'
import crypto from 'crypto'

import verifyTrustlessWorkSignature from '../middleware/trustlesswork-signature.middleware'
import { authMiddleware } from '../middleware/auth.middleware'

// ── Routes ────────────────────────────────────────────────────────────────────
import initializeRoute from './escrows/initialize.route'
import fundRoute from './escrows/fund.route'
import approveMilestoneRoute from './escrows/approve-milestone.route'
import releaseFundsRoute from './escrows/release-funds.route'
import disputeRoute from './escrows/dispute.route'
import resolveDisputeRoute from './escrows/resolve-dispute.route'

import authRoutes from './auth'
import apartmentRoutes from './apartments/list.route'
import bidRequestsRoute from './bid-requests'
import reservationsRoute from './reservations'
import hotelConversationsRoute from './hotel/conversations/send.route'

const router = express.Router()

// ── Service-to-service auth for internal callers (hotel conversations) ────────
function verifyInternalSecret(req: Request, res: Response, next: NextFunction) {
  const token  = req.headers['x-internal-secret'] as string | undefined
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
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' })
})

// ── 2. TrustlessWork webhook callbacks (HMAC verified, no Firebase auth) ──────
router.use('/api/escrows', verifyTrustlessWorkSignature as RequestHandler)
router.use(initializeRoute)
router.use(fundRoute)
router.use(approveMilestoneRoute)
router.use(releaseFundsRoute)
router.use(disputeRoute)
router.use(resolveDisputeRoute)

const transitionsRoute = require('./escrow-transitions.route');
router.use(transitionsRoute);

// ── 3. Hotel conversations (service-to-service auth) ─────────────────────────
router.use('/api/hotel', verifyInternalSecret as RequestHandler)
router.use(hotelConversationsRoute)

// ── 4. Authenticated routes (Firebase auth required) ──────────────────────────
router.use('/api', authMiddleware as unknown as RequestHandler)
router.use('/api/auth',         authRoutes)
router.use('/api/apartments',   apartmentRoutes)
router.use('/api/bid-requests', bidRequestsRoute)
router.use('/api/reservations', reservationsRoute)

export default router