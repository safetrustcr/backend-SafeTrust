import { NextFunction, Request, RequestHandler, Response, Router } from 'express'
import { paymentMiddleware } from '@x402/express'
import {
  consumeVerifiedPayer,
  getActiveX402ResourceServer,
  getX402Config,
} from '../../../config/x402'
import { createHoldHandler, releaseHoldHandler } from './hold.handler'
import { requireRole } from '../../../middleware/require-role'

/** Price of a hold in USDC, charged through x402. Not refunded. */
export const HOLD_PRICE_USDC = 0.01

let cachedHoldPaymentMiddleware: RequestHandler | null = null

export function setHoldPaymentMiddleware(mw: RequestHandler | null): void {
  cachedHoldPaymentMiddleware = mw
}

function getHoldPaymentMiddleware(): RequestHandler {
  if (cachedHoldPaymentMiddleware) {
    return cachedHoldPaymentMiddleware
  }
  const config = getX402Config()
  const server = getActiveX402ResourceServer()
  const price = `$${HOLD_PRICE_USDC.toFixed(2)}`

  cachedHoldPaymentMiddleware = paymentMiddleware(
    {
      'POST /hold': {
        accepts: [
          {
            scheme: 'exact',
            price,
            network: config.network,
            payTo: config.payTo,
          },
        ],
        description: 'SafeTrust booking hold fee',
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
                maxAmountRequired: HOLD_PRICE_USDC,
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

  return cachedHoldPaymentMiddleware
}

function requireHoldX402Payment(req: Request, res: Response, next: NextFunction): void {
  if (process.env.X402_ENABLED !== 'true') {
    res.status(503).json({
      error: 'Feature Unavailable',
      feature: 'x402',
      message: 'x402 payments are disabled',
    })
    return
  }

  delete req.headers['x-payment']
  const config = getX402Config()
  const mw = getHoldPaymentMiddleware()
  mw(req, res, (err?: unknown) => {
    if (err) {
      next(err)
      return
    }
    const sig = req.headers['payment-signature']
    const payer = consumeVerifiedPayer(typeof sig === 'string' ? sig : undefined)
    req.x402 = {
      payer,
      amountUsdc: HOLD_PRICE_USDC,
      network: config.network,
    }
    next()
  })
}

const router: Router = Router()

// /api/v1 sits under the /api boundary, which already requires a session (401).
// The session check therefore runs before the payment challenge.
router.post(
  '/hold',
  requireRole(['guest']),
  requireHoldX402Payment,
  createHoldHandler as unknown as RequestHandler
)
router.delete('/hold/:id', requireRole(['guest']), releaseHoldHandler as unknown as RequestHandler)

export default router
