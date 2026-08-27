import { Router, Request, Response, NextFunction, RequestHandler } from 'express'
import { initializeEscrowHandler } from './initialize.handler'
import { requireX402Payment } from '../../middleware/x402-payment.middleware'
import verifyTrustlessWorkSignature from '../../middleware/trustlesswork-signature.middleware'

const router = Router()
const x402Middleware = requireX402Payment(0.10)

router.post(
  '/api/escrows/initialize',
  (req: Request, res: Response, next: NextFunction) => {
    // 1. If explicit x402 protocol / payment header is present, enforce x402
    if (req.headers['x-payment'] !== undefined ||
        req.headers['x-payment-protocol'] !== undefined ||
        req.headers['x-payment-required'] !== undefined) {
      return x402Middleware(req, res, next)
    }

    // 2. If X402_ENABLED is true and no TrustlessWork signature is provided, enforce x402
    if (process.env.X402_ENABLED === 'true' && !req.headers['x-trustlesswork-signature']) {
      return x402Middleware(req, res, next)
    }

    // 3. Otherwise (TrustlessWork webhook flow or default), enforce TrustlessWork HMAC signature
    return (verifyTrustlessWorkSignature as RequestHandler)(req, res, next)
  },
  initializeEscrowHandler
)

export default router
module.exports = router
module.exports.default = router
