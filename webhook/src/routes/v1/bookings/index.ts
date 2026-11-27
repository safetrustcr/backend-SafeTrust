import { NextFunction, Request, RequestHandler, Response, Router } from 'express'
import { paymentMiddleware } from '@x402/express'
import {
  consumeVerifiedPayer,
  getActiveX402ResourceServer,
  getX402Config,
} from '../../../config/x402'
import { createHoldHandler, releaseHoldHandler } from './hold.handler'
import { releaseHold } from '../../../repositories/hold.repository'
import { requireRole } from '../../../middleware/require-role'
import { requireX402Enabled } from '../../../middleware/x402-feature-gate'
import { logger } from '../../../middleware/logger'

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
  delete req.headers['x-payment']

  res.on('finish', () => {
    const sig = req.headers['payment-signature']
    if (typeof sig === 'string') {
      consumeVerifiedPayer(sig)
    }
    const activatedHold = res.locals.activatedHold as
      | { id: string; userId: string; tenantId: string }
      | undefined
    if (activatedHold && res.statusCode >= 400) {
      releaseHold(activatedHold.id, activatedHold.userId, activatedHold.tenantId).catch((err) => {
        logger.error('bookings.hold.settlement_failure_release_failed', {
          holdId: activatedHold.id,
          error: err instanceof Error ? err : new Error(String(err)),
        })
      })
    }
  })

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
  requireX402Enabled,
  requireHoldX402Payment,
  createHoldHandler as unknown as RequestHandler
)
router.delete('/hold/:id', requireRole(['guest']), releaseHoldHandler as unknown as RequestHandler)

export default router
