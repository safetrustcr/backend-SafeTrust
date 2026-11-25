import { Router, Request, Response, NextFunction } from 'express'
import { initializeEscrowHandler } from './initialize.handler'
import { requireX402Payment } from '../../middleware/x402-payment.middleware'
import { validate } from '../../middleware/validate'
import { escrowInitializationSchema } from '../../validation'

const router = Router()
const x402Middleware = requireX402Payment(0.10)

router.post(
  '/api/escrows/initialize',
  (req: Request, res: Response, next: NextFunction) => {
    // Explicit x402 headers always use the payment middleware.
    if (
      req.headers['x-payment'] !== undefined ||
      req.headers['x-payment-protocol'] !== undefined ||
      req.headers['x-payment-required'] !== undefined
    ) {
      return x402Middleware(req, res, next)
    }

    // Do not fall through to the handler when x402 is disabled.
    return x402Middleware(req, res, next)
  },
  validate(escrowInitializationSchema),
  initializeEscrowHandler
)

export default router
module.exports = router
module.exports.default = router
