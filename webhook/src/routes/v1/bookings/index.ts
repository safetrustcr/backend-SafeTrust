import { RequestHandler, Router } from 'express'
import { requireX402Payment } from '../../../middleware/x402-payment.middleware'
import { createHoldHandler, releaseHoldHandler } from './hold.handler'
import { requireRole } from '../../../middleware/require-role'

/** Price of a hold in USDC, charged through x402. Not refunded. */
export const HOLD_PRICE_USDC = 0.01

const router: Router = Router()

// /api/v1 sits under the /api boundary, which already requires a session (401).
// The session check therefore runs before the payment challenge.
router.post(
  '/hold',
  requireRole(['guest']),
  requireX402Payment(HOLD_PRICE_USDC),
  createHoldHandler as unknown as RequestHandler
)
router.delete('/hold/:id', requireRole(['guest']), releaseHoldHandler as unknown as RequestHandler)

export default router
