import { RequestHandler, Router } from 'express'
import { requireX402Payment } from '../../../middleware/x402-payment.middleware'
import { createHoldHandler, releaseHoldHandler } from './hold.handler'
import { createBookingHandler } from './create.handler'
import { submitBookingHandler } from './submit.handler'
import { requireRole } from '../../../middleware/require-role'

/** Price of a hold in USDC, charged through x402. Not refunded. */
export const HOLD_PRICE_USDC = 0.01

/** Booking fee in USDC, charged through x402 to SafeTrust fee account. */
export const BOOKING_FEE_USDC = 0.10

const router: Router = Router()

// /api/v1 sits under the /api boundary, which already requires a session (401).
// The session check therefore runs before the payment challenge.

// 1. Hold routes (Issue 20)
router.post(
  '/hold',
  requireRole(['guest']),
  requireX402Payment(HOLD_PRICE_USDC),
  createHoldHandler as unknown as RequestHandler
)
router.delete('/hold/:id', requireRole(['guest']), releaseHoldHandler as unknown as RequestHandler)

// 2. Create booking endpoint (Issue #778)
router.post(
  '/',
  requireRole(['guest']),
  requireX402Payment(BOOKING_FEE_USDC),
  createBookingHandler as unknown as RequestHandler
)

// 3. Submit booking signed XDR (Issue #778)
router.post(
  '/:id/submit',
  requireRole(['guest']),
  submitBookingHandler as unknown as RequestHandler
)

export default router
