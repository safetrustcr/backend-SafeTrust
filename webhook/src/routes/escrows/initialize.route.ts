import { Router, Request, Response, NextFunction, RequestHandler } from 'express'
import { paymentMiddleware } from '@x402/express'
import { initializeEscrowHandler } from './initialize.handler'
import {
  consumeVerifiedPayer,
  getX402Config,
  getActiveX402ResourceServer,
} from '../../config/x402'
import { ServiceUnavailableError } from '../../utils/errors'

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
        unpaidResponseBody: () => ({
          contentType: 'application/json',
          body: {
            error: 'Payment Required',
            x402Version: 2,
            accepts: [
              {
                scheme: 'exact',
                network: config.network,
                asset: {
                  code: 'USDC',
                  contract:
                    config.network === 'stellar:pubnet'
                      ? 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75'
                      : 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
                },
                facilitator_url: config.facilitatorUrl,
                pay_to: config.payTo,
              },
            ],
          },
        }),
      },
    },
    server,
    undefined,
    undefined,
    false
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
    if (process.env.X402_ENABLED !== 'true') {
      // Fails closed with a typed 503 so the shared error handler owns the
      // response shape (Issue #815): route modules never build error bodies.
      next(
        new ServiceUnavailableError('x402 payments are disabled', {
          code: 'feature_unavailable',
        })
      )
      return
    }

    // The paid path trusts only PAYMENT-SIGNATURE (x402 v2).
    // Discard legacy x-payment so it cannot satisfy the payment gate.
    delete req.headers['x-payment']

    res.on('finish', () => {
      const sig = req.headers['payment-signature']
      if (typeof sig === 'string') {
        consumeVerifiedPayer(sig)
      }
    })

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
