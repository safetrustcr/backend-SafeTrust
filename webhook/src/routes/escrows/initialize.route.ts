import { Router, Request, Response, NextFunction, RequestHandler } from 'express'
import { paymentMiddleware } from '@x402/express'
import { initializeEscrowHandler } from './initialize.handler'
import verifyTrustlessWorkSignature from '../../middleware/trustlesswork-signature.middleware'
import {
  getX402Config,
  getActiveX402ResourceServer,
} from '../../config/x402'

const router = Router()

let cachedPaymentMiddleware: RequestHandler | null = null

/**
 * Builds the @x402/express payment middleware for /api/escrows/initialize.
 */
export function buildPaymentMiddleware(): RequestHandler {
  const config = getX402Config()
  const server = getActiveX402ResourceServer()

  return paymentMiddleware(
    {
      'POST /api/escrows/initialize': {
        accepts: [
          {
            scheme: 'exact',
            price: config.price,
            network: config.network,
            payTo: config.payTo,
          },
        ],
        description: 'SafeTrust escrow initialization fee',
        mimeType: 'application/json',
      },
    },
    server,
    undefined,
    undefined,
    true
  ) as unknown as RequestHandler
}

/**
 * Test seam to get or override the payment middleware instance.
 */
export function getPaymentMiddleware(): RequestHandler {
  if (cachedPaymentMiddleware) {
    return cachedPaymentMiddleware
  }
  cachedPaymentMiddleware = buildPaymentMiddleware()
  return cachedPaymentMiddleware
}

export function setPaymentMiddleware(mw: RequestHandler | null): void {
  cachedPaymentMiddleware = mw
}

router.post(
  '/api/escrows/initialize',
  (req: Request, res: Response, next: NextFunction) => {
    // Explicit x402 headers always trigger the payment gate.
    const hasExplicitX402Header =
      req.headers['payment-signature'] !== undefined ||
      req.headers['x-payment'] !== undefined ||
      req.headers['x-payment-protocol'] !== undefined ||
      req.headers['x-payment-required'] !== undefined ||
      (typeof req.headers['authorization'] === 'string' &&
        req.headers['authorization'].startsWith('x402 '))

    if (hasExplicitX402Header) {
      if (process.env.X402_ENABLED !== 'true') {
        res.status(503).json({
          error: 'Feature Unavailable',
          feature: 'x402',
          message: 'x402 payments are disabled',
        })
        return
      }
      // The paid path trusts only PAYMENT-SIGNATURE (x402 v2).
      // Discard legacy x-payment so it cannot satisfy the payment gate.
      delete req.headers['x-payment']
      return getPaymentMiddleware()(req, res, next)
    }

    // TrustlessWork callbacks must still pass signature verification.
    if (req.headers['x-trustlesswork-signature']) {
      return (verifyTrustlessWorkSignature as RequestHandler)(req, res, next)
    }

    // When x402 is disabled and no signature header is present, fail closed with 503.
    if (process.env.X402_ENABLED !== 'true') {
      res.status(503).json({
        error: 'Feature Unavailable',
        feature: 'x402',
        message: 'x402 payments are disabled',
      })
      return
    }

    // Enforce x402 payment (trusts only PAYMENT-SIGNATURE)
    delete req.headers['x-payment']
    return getPaymentMiddleware()(req, res, next)
  },
  initializeEscrowHandler
)

export default router
module.exports = router
module.exports.default = router
module.exports.buildPaymentMiddleware = buildPaymentMiddleware
module.exports.getPaymentMiddleware = getPaymentMiddleware
module.exports.setPaymentMiddleware = setPaymentMiddleware
