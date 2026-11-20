import express, { RequestHandler } from 'express'

import verifyTrustlessWorkSignature from '../middleware/trustlesswork-signature.middleware'
import { authMiddleware } from '../middleware/auth.middleware'

import { getTransitionTable } from '../lib/escrow-transitions'

// ── Routes ────────────────────────────────────────────────────────────────────
import initializeRoute from './escrows/initialize.route'
import confirmTransactionRoute from './escrows/confirm-transaction.route'
import fundRoute from './escrows/fund.route'
import approveMilestoneRoute from './escrows/approve-milestone.route'
import releaseFundsRoute from './escrows/release-funds.route'
import disputeRoute from './escrows/dispute.route'
import resolveDisputeRoute from './escrows/resolve-dispute.route'

import healthRoutes from './health.route'
import authRoutes from './auth'
import apartmentRoutes from './apartments'
import bidRequestsRoute from './bid-requests'
import reservationsRoute from './reservations'
import escrowClaimsRoute from './escrow-claims/claims.route'

const router = express.Router()

// ── 1. Dependency readiness check (public) ────────────────────────────────────
router.use(healthRoutes)

// ── 2. Escrows / x402 booking entrypoint & TrustlessWork callbacks ──────────────
router.use(initializeRoute)
router.use('/api/escrows', verifyTrustlessWorkSignature as RequestHandler)
router.use(fundRoute)
router.use(approveMilestoneRoute)
router.use(releaseFundsRoute)
router.use(disputeRoute)
router.use(resolveDisputeRoute)

// ── 3. Authenticated routes (Firebase auth required) ──────────────────────────
router.use('/api', authMiddleware as unknown as RequestHandler)
router.use(confirmTransactionRoute)
router.use('/api/auth',         authRoutes)
router.use('/api/apartments',   apartmentRoutes)
router.use('/api/bid-requests', bidRequestsRoute)
router.use('/api/reservations', reservationsRoute)
router.use('/api/escrow-claims', escrowClaimsRoute)

export default router