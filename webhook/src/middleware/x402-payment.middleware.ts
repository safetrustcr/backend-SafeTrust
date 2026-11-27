import { Request, Response, NextFunction } from 'express'
import type {
  PaymentPayload,
  PaymentRequirements,
} from '@x402/core/types'
import {
  getActiveX402ResourceServer,
  getX402Config,
  resolveStellarNetwork,
  type StellarPaymentNetwork,
} from '../config/x402'
import { logger } from './logger'

export interface X402SettlementResult {
  settled: boolean
  transaction_hash?: string | null
  network?: string
  error?: string | null
}

/**
 * Payment-processor seam. The default engine verifies and settles through the
 * official `@x402` Stellar packages; tests inject a fake through
 * {@link setX402Engine}.
 */
export interface X402Engine {
  /** Verify a payment header; returns a JSON string of `{ is_valid, ... }`. */
  validateX402Payment: (header: string, requiredAmount: number) => string | Promise<string>
  /** Verify and settle a payment header with the facilitator. */
  settleX402Payment?: (
    header: string,
    requiredAmount: number
  ) => Promise<X402SettlementResult>
  /** Build the payment requirement advertised in the 402 challenge. */
  buildPaymentRequirement: (
    amountUsdc: number,
    network: string,
    facilitatorUrl: string,
    payTo: string
  ) => string
}

/** USDC Soroban contract used by the x402 `exact` Stellar scheme. */
const USDC_CONTRACTS: Record<string, string> = {
  'stellar:pubnet': 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
  'stellar:testnet': 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
}

interface ValidationResult {
  is_valid: boolean
  payer_address?: string | null
  amount_usdc?: number
  network?: string
  invalid_reason?: string | null
}

/**
 * The payment header carries the base64-encoded x402 payment payload, either
 * bare or prefixed with the `x402` scheme token.
 */
function decodePaymentPayload(header: string): PaymentPayload {
  const trimmed = header.trim()
  const encoded = trimmed.toLowerCase().startsWith('x402 ')
    ? trimmed.slice(5).trim()
    : trimmed
  const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('X-Payment header does not contain an x402 payment payload')
  }
  return decoded as PaymentPayload
}

/** Payment requirements for an amount, built by the registered Stellar scheme. */
async function requirementsFor(amountUsdc: number): Promise<PaymentRequirements[]> {
  const config = getX402Config()
  const server = getActiveX402ResourceServer()
  return server.buildPaymentRequirementsFromOptions(
    [
      {
        scheme: 'exact',
        payTo: config.payTo,
        price: `$${amountUsdc.toFixed(2)}`,
        network: config.network,
      },
    ],
    {}
  )
}

function unusable(reason: string): string {
  return JSON.stringify({ is_valid: false, invalid_reason: reason })
}

/**
 * Verify a payment header against the requirements this service advertises.
 * Only the facilitator decides whether the signed authorization is valid.
 */
async function verifyPayment(
  header: string,
  requiredAmount: number
): Promise<{ result: ValidationResult; requirements?: PaymentRequirements }> {
  let payload: PaymentPayload
  try {
    payload = decodePaymentPayload(header)
  } catch (error) {
    return {
      result: {
        is_valid: false,
        invalid_reason:
          error instanceof Error ? error.message : 'Invalid X-Payment header',
      },
    }
  }

  const server = getActiveX402ResourceServer()
  const requirements = await requirementsFor(requiredAmount)
  const matched = server.findMatchingRequirements(requirements, payload)
  if (!matched) {
    return {
      result: {
        is_valid: false,
        invalid_reason:
          'Payment does not match the required scheme, network, asset or payee',
      },
    }
  }

  const verified = await server.verifyPayment(payload, matched)
  if (!verified.isValid) {
    return {
      result: {
        is_valid: false,
        invalid_reason: verified.invalidReason ?? 'Payment verification failed',
        payer_address: verified.payer ?? null,
        network: matched.network,
      },
      requirements: matched,
    }
  }

  return {
    result: {
      is_valid: true,
      payer_address: verified.payer ?? null,
      amount_usdc: requiredAmount,
      network: matched.network,
    },
    requirements: matched,
  }
}

/**
 * Default engine: verification and settlement run through the official x402
 * resource server, so the facilitator's signature checks and the settlement
 * transaction are the ones the protocol defines.
 */
const defaultEngine: X402Engine = {
  buildPaymentRequirement(amountUsdc, network, facilitatorUrl, payTo) {
    return JSON.stringify({
      scheme: 'exact',
      network,
      maxAmountRequired: amountUsdc,
      asset: {
        code: 'USDC',
        contract: USDC_CONTRACTS[network] ?? USDC_CONTRACTS['stellar:testnet'],
      },
      facilitator_url: facilitatorUrl,
      pay_to: payTo,
    })
  },

  async validateX402Payment(header, requiredAmount) {
    const { result } = await verifyPayment(header, requiredAmount)
    return JSON.stringify(result)
  },

  async settleX402Payment(header, requiredAmount) {
    const { result, requirements } = await verifyPayment(header, requiredAmount)
    if (!result.is_valid || !requirements) {
      return { settled: false, error: result.invalid_reason ?? 'Payment was not verified' }
    }

    const server = getActiveX402ResourceServer()
    const payload = decodePaymentPayload(header)
    const settled = await server.settlePayment(payload, requirements)
    return {
      settled: Boolean(settled.success),
      transaction_hash: settled.success ? settled.transaction : null,
      network: settled.network ?? requirements.network,
      error: settled.success ? null : settled.errorReason ?? 'Settlement declined',
    }
  },
}

// undefined = not resolved yet; null = explicitly injected as absent.
let injectedEngine: X402Engine | null | undefined

/** Test seam: override or remove the payment engine. */
export function setX402Engine(engine: X402Engine | null): void {
  injectedEngine = engine
}

/** The active payment engine, or null when none is available. */
export function getX402Engine(): X402Engine | null {
  if (injectedEngine !== undefined) return injectedEngine
  return defaultEngine
}

export interface X402Context {
  payer?: string | null
  amountUsdc: number
  network: string
  /** Raw payment header, used to settle and derive an idempotency key. */
  paymentHeader: string
}

/**
 * Recovery hook for an already-settled proof. Replaying a settled payment is
 * rejected by the facilitator, so verification alone cannot tell a legitimate
 * retry from a forged proof: the hook answers only from the settlement ledger,
 * and the handler it feeds never charges that proof a second time.
 */
export type SettledProofRecovery = (
  paymentHeader: string,
  amountUsdc: number
) => Promise<{ payer?: string | null; amountUsdc: number; network: string } | null>

export interface X402PaymentOptions {
  /** Consulted only when verification fails, before answering 402. */
  recoverSettledProof?: SettledProofRecovery
}

/**
 * The v2 payment proof travels in `PAYMENT-SIGNATURE`; `X-Payment` is the
 * legacy spelling and is still accepted so older clients keep working.
 */
function readPaymentHeader(req: Request): string | undefined {
  const raw = req.headers['payment-signature'] ?? req.headers['x-payment']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Network the resource server verifies against, resolved the same way. */
function verificationNetwork(): StellarPaymentNetwork {
  return resolveStellarNetwork(process.env.STELLAR_NETWORK || process.env.X402_NETWORK)
}

/**
 * Fails closed with the documented `503 Feature Unavailable` body whenever
 * `X402_ENABLED` is not `true`. Shared by every x402-gated route so the
 * disabled contract is identical everywhere.
 */
export function requireX402Enabled(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (process.env.X402_ENABLED !== 'true') {
    res.status(503).json({
      error: 'Feature Unavailable',
      feature: 'x402',
      message: 'x402 payments are disabled',
    })
    return
  }
  next()
}

export const requireX402Payment =
  (amountUsdc: number, options: X402PaymentOptions = {}) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.X402_ENABLED !== 'true') {
      requireX402Enabled(req, res, next)
      return
    }

    const engine = getX402Engine()
    if (!engine) {
      res.status(503).json({
        error: 'Feature Unavailable',
        feature: 'x402',
        message: 'x402 payment processor is unavailable',
      })
      return
    }

    // Same network the resource server verifies against, so the challenge can
    // never advertise requirements that verification would reject.
    const network = verificationNetwork()
    const facilitatorUrl =
      process.env.X402_FACILITATOR_URL ??
      (network === 'stellar:pubnet'
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
    const paymentHeader = readPaymentHeader(req)

    try {
      if (!paymentHeader) {
        const requirement = JSON.parse(
          engine.buildPaymentRequirement(
            amountUsdc,
            network,
            facilitatorUrl,
            platformWallet
          )
        )
        const challenge = {
          error: 'Payment Required',
          x402Version: 2,
          accepts: [requirement],
        }

        // v2 clients read the challenge from `PAYMENT-REQUIRED`, base64 JSON.
        // The body keeps the shape older clients already parse.
        res.set(
          'PAYMENT-REQUIRED',
          Buffer.from(JSON.stringify(challenge)).toString('base64')
        )
        res.status(402).json(challenge)
        return
      }

      const result = JSON.parse(
        await engine.validateX402Payment(paymentHeader, amountUsdc)
      ) as ValidationResult

      if (!result.is_valid) {
        const recovered = options.recoverSettledProof
          ? await options.recoverSettledProof(paymentHeader, amountUsdc)
          : null
        if (recovered) {
          req.x402 = { ...recovered, paymentHeader }
          next()
          return
        }

        res.status(402).json({
          error: 'Invalid x402 payment',
          invalid_reason: result.invalid_reason,
          x402Version: 2,
        })
        return
      }

      req.x402 = {
        payer: result.payer_address ?? null,
        amountUsdc: result.amount_usdc ?? amountUsdc,
        network: result.network ?? network,
        paymentHeader,
      }
      next()
    } catch (error) {
      const err = error as Error
      logger.error('x402.validation_failed', { error: err })
      res.status(500).json({ error: 'Payment validation failed' })
    }
  }
