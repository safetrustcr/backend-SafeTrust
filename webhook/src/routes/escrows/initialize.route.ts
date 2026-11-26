import { Router, Request, Response, NextFunction, RequestHandler } from 'express'
import { paymentMiddleware } from '@x402/express'
import { initializeEscrowHandler } from './initialize.handler'
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
      res.status(503).json({
        error: 'Feature Unavailable',
        feature: 'x402',
        message: 'x402 payments are disabled',
      })
      return
    }

    const xPayment = req.headers['x-payment']
    if (typeof xPayment === 'string' && !req.headers['payment-signature']) {
      if (!xPayment.startsWith('x402 ')) {
        const config = getX402Config()
        const requirements = {
          x402Version: 2,
          error: 'Invalid x402 payment',
          accepts: [
            {
              scheme: 'exact',
              network: config.network,
              asset:
                config.network === 'stellar:pubnet'
                  ? 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75'
                  : 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
              payTo: config.payTo,
            },
          ],
        }
        res.setHeader(
          'payment-required',
          Buffer.from(JSON.stringify(requirements)).toString('base64')
        )
        res.status(402).json({
          error: 'Invalid x402 payment',
          invalid_reason: `Invalid X-Payment header format — must start with 'x402 ', got: '${xPayment}'`,
          x402Version: 2,
        })
        return
      }
    }

    // The paid path trusts only PAYMENT-SIGNATURE (x402 v2).
    // Discard legacy x-payment so it cannot satisfy the payment gate.
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
