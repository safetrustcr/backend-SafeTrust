import { Request, Response, NextFunction } from 'express'

let x402Addon: {
  validateX402Payment: (header: string, requiredAmount: number) => string
  buildPaymentRequirement: (
    amountUsdc: number,
    network: string,
    facilitatorUrl: string,
    payTo: string
  ) => string
} | null = null

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  x402Addon = require('../../../crates/x402-processor')
} catch {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    x402Addon = require('../../crates/x402-processor')
  } catch {
    // Addon will be injected in tests or when native module is built
  }
}

/** Test seam: allow tests to override or inject the native addon */
export function setX402Addon(addon: typeof x402Addon): void {
  x402Addon = addon
}

export interface X402Context {
  payer?: string | null
  amountUsdc: number
  network: string
}

declare global {
  namespace Express {
    interface Request {
      x402?: X402Context
    }
  }
}

export const requireX402Payment =
  (amountUsdc: number) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const NETWORK = process.env.STELLAR_NETWORK ?? 'testnet'
    const FACILITATOR_URL =
      process.env.X402_FACILITATOR_URL ??
      (NETWORK === 'mainnet'
        ? 'https://channels.openzeppelin.com/x402'
        : 'https://channels.openzeppelin.com/x402/testnet')
    const PLATFORM_WALLET = process.env.SAFETRUST_PLATFORM_WALLET ?? ''

    const paymentHeader = req.headers['x-payment'] as string | undefined

    // No payment header → return 402 with payment requirements
    if (!paymentHeader) {
      if (!x402Addon) {
        // Fallback in case native addon failed to load
        const fallbackRequirement = {
          scheme: 'exact',
          network: `stellar:${NETWORK}`,
          max_amount_usdc: amountUsdc,
          asset: {
            code: 'USDC',
            contract:
              NETWORK === 'mainnet'
                ? 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75'
                : 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
            issuer:
              NETWORK === 'mainnet'
                ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
                : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          },
          facilitator_url: FACILITATOR_URL,
          pay_to: PLATFORM_WALLET,
          description: 'SafeTrust booking fee',
        }
        res.status(402).json({
          error: 'Payment Required',
          x402Version: 2,
          accepts: [fallbackRequirement],
        })
        return
      }

      const requirementJson = x402Addon.buildPaymentRequirement(
        amountUsdc,
        `stellar:${NETWORK}`,
        FACILITATOR_URL,
        PLATFORM_WALLET
      )
      const requirement = JSON.parse(requirementJson)
      res.status(402).json({
        error: 'Payment Required',
        x402Version: 2,
        accepts: [requirement],
      })
      return
    }

    // Payment header present → validate via Rust + facilitator
    try {
      if (!x402Addon) {
        throw new Error('x402-processor native addon not loaded')
      }

      const resultJson = x402Addon.validateX402Payment(paymentHeader, amountUsdc)
      const result = JSON.parse(resultJson)

      if (!result.is_valid) {
        res.status(402).json({
          error: 'Invalid x402 payment',
          invalid_reason: result.invalid_reason,
          x402Version: 2,
        })
        return
      }

      // Attach payer info to request for downstream handlers
      req.x402 = {
        payer: result.payer_address,
        amountUsdc: result.amount_usdc,
        network: result.network,
      }
      next()
    } catch (error) {
      const err = error as Error
      console.error('[x402] ❌ Validation error:', err.message)
      res.status(500).json({ error: 'Payment validation failed' })
    }
  }
