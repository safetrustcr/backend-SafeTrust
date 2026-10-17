import { Router, Request, Response, NextFunction, RequestHandler } from 'express'
import { initializeEscrowHandler } from './initialize.handler'
import verifyTrustlessWorkSignature from '../../middleware/trustlesswork-signature.middleware'

const router = Router()

type X402Middleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void

/**
 * Load x402 only when the quarantine flag is on.
 *
 * A static import would require `x402-processor` (and its native addon) on
 * every boot, even with the default `X402_ENABLED=false`. Keeping it lazy means
 * the eligibility path has no runtime dependency on the quarantined crate at
 * all unless an operator explicitly enables it.
 */
function getX402Middleware(): X402Middleware {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { requireX402Payment } = require('../../middleware/x402-payment.middleware') as {
    requireX402Payment: (amountUsdc: number) => X402Middleware
  }
  return requireX402Payment(0.10)
}

/**
 * Escrow initialization is the eligibility boundary: a request that reaches
 * `initializeEscrowHandler` may create booking/escrow state.
 *
 * x402 is quarantined from that boundary. It is only evaluated when
 * `X402_ENABLED=true`; with the default `false`, every request — including one
 * carrying an `X-Payment` header — must pass the TrustlessWork HMAC check.
 * This prevents an unresolved x402 finding (F2/F3/F8) from granting booking
 * eligibility while the processor is under review.
 */
router.post(
  '/api/escrows/initialize',
  (req: Request, res: Response, next: NextFunction) => {
    if (process.env.X402_ENABLED === 'true') {
      const x402Middleware = getX402Middleware()

      // 1. An explicit x402 protocol header always selects the x402 path.
      if (
        req.headers['x-payment'] !== undefined ||
        req.headers['x-payment-protocol'] !== undefined ||
        req.headers['x-payment-required'] !== undefined
      ) {
        return x402Middleware(req, res, next)
      }

      // 2. When x402 is enabled, a request without a TrustlessWork signature
      //    must pay. A signed callback is the non-x402 path.
      if (!req.headers['x-trustlesswork-signature']) {
        return x402Middleware(req, res, next)
      }
    }

    // 3. Default path: TrustlessWork HMAC-verified callback. This is the only
    //    path that can reach the handler while x402 is disabled.
    return (verifyTrustlessWorkSignature as RequestHandler)(req, res, next)
  },
  initializeEscrowHandler
)

export default router
module.exports = router
module.exports.default = router
