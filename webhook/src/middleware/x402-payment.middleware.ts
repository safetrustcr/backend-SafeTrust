import { Request, Response, NextFunction } from 'express'

type X402Addon = {
  validateX402Payment: (header: string, requiredAmount: number) => string
  buildPaymentRequirement: (
    amountUsdc: number,
    network: string,
    facilitatorUrl: string,
    payTo: string
  ) => string
}

// undefined = not loaded yet; null = unavailable or explicitly injected as absent.
let x402Addon: X402Addon | null | undefined

function getX402Addon(): X402Addon | null {
  if (x402Addon !== undefined) return x402Addon

  try {
    // Load the experimental native addon only when x402 is enabled and used.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    x402Addon = require('../../../crates/x402-processor')
  } catch (error) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      x402Addon = require('../../crates/x402-processor')
    } catch (fallbackError) {
      x402Addon = null
      console.warn('[x402] native addon unavailable; payment validation will fail closed without it:', {
        primaryPathError: error instanceof Error ? error.message : error,
        fallbackPathError:
          fallbackError instanceof Error ? fallbackError.message : fallbackError,
      })
    }
  }

  return x402Addon ?? null
}

/** Test seam: allow tests to override or inject the native addon */
export function setX402Addon(addon: X402Addon | null): void {
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
    if (process.env.X402_ENABLED !== 'true') {
      res.status(503).json({
        error: 'Feature Unavailable',
        feature: 'x402',
        message: 'x402 payments are disabled',
      })
      return
    }

    const addon = getX402Addon()
    if (!addon) {
      res.status(503).json({
        error: 'Feature Unavailable',
        feature: 'x402',
        message: 'x402 payment processor is unavailable',
      })
      return
    }

    const network = process.env.STELLAR_NETWORK ?? 'testnet'
    const facilitatorUrl =
      process.env.X402_FACILITATOR_URL ??
      (network === 'mainnet'
        ? 'https://channels.openzeppelin.com/x402'
        : 'https://channels.openzeppelin.com/x402/testnet')
    const platformWallet = process.env.SAFETRUST_PLATFORM_WALLET?.trim() ?? ''
    if (!platformWallet) {
      res.status(503).json({
        error: 'Feature Unavailable',
        feature: 'x402',
        message: 'x402 platform wallet is not configured',
      })
      return
    }
    const paymentHeader = req.headers['x-payment'] as string | undefined

    try {
      if (!paymentHeader) {
        const requirement = JSON.parse(
          addon.buildPaymentRequirement(
            amountUsdc,
            `stellar:${network}`,
            facilitatorUrl,
            platformWallet
          )
        )

        res.status(402).json({
          error: 'Payment Required',
          x402Version: 2,
          accepts: [requirement],
        })
        return
      }

      const result = JSON.parse(
        addon.validateX402Payment(paymentHeader, amountUsdc)
      )

      if (!result.is_valid) {
        res.status(402).json({
          error: 'Invalid x402 payment',
          invalid_reason: result.invalid_reason,
          x402Version: 2,
        })
        return
      }

      req.x402 = {
        payer: result.payer_address,
        amountUsdc: result.amount_usdc,
        network: result.network,
      }
      next()
    } catch (error) {
      const err = error as Error
      console.error('[x402] Validation error:', err.message)
      res.status(500).json({ error: 'Payment validation failed' })
    }
  }
