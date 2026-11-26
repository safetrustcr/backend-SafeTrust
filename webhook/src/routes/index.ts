import express, { RequestHandler } from 'express'

import { authMiddleware } from '../middleware/auth.middleware'
import { apiRateLimit, authRateLimit } from '../middleware/rate-limit'

import { getTransitionTable } from '../lib/escrow-transitions'

// ── Routes ────────────────────────────────────────────────────────────────────
import initializeRoute from './escrows/initialize.route'
import confirmTransactionRoute from './escrows/confirm-transaction.route'

import healthRoutes from './health.route'
import authRoutes from './auth'
import apartmentRoutes from './apartments'
import bidRequestsRoute from './bid-requests'
import reservationsRoute from './reservations'
import escrowClaimsRoute from './escrow-claims/claims.route'
import v1BookingsRoute from './v1/bookings'

const router = express.Router()

// ── 1. Dependency readiness check (public) ────────────────────────────────────
router.use(healthRoutes)

// ── 2. Escrows / x402 booking entrypoint ──────────────────────────────────────
router.use(initializeRoute)

// ── 3. Authenticated routes (Firebase auth required) ──────────────────────────
router.use('/api', authMiddleware as unknown as RequestHandler, apiRateLimit)
router.use('/api/auth', authRateLimit)
router.use('/api/auth',         authRoutes)
router.use('/api/apartments',   apartmentRoutes)
router.use('/api/bid-requests', bidRequestsRoute)
router.use('/api/reservations', reservationsRoute)
router.use('/api/escrow-claims', escrowClaimsRoute)
router.use('/api/v1/bookings', v1BookingsRoute)
router.use(confirmTransactionRoute)

export default router