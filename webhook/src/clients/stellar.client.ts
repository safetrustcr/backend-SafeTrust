'use strict'

import { logger } from '../middleware/logger'
import { UpstreamError, UpstreamTimeoutError } from '../utils/errors'
import type { StellarNetwork } from '../services/confirmation.service'

export const VALID_TX_HASH = /^[0-9a-fA-F]{64}$/

export interface StellarVerificationResult {
  verified: boolean
  ledger?: number
  successful?: boolean
  networkMatch?: boolean
  error?: string
}

function parseTimeout(val: string | undefined, defaultMs: number): number {
  if (!val) return defaultMs
  const parsed = parseInt(val, 10)
  return isNaN(parsed) || parsed <= 0 ? defaultMs : parsed
}

export function getHorizonTimeoutMs(): number {
  return parseTimeout(process.env.STELLAR_HORIZON_TIMEOUT_MS, 10_000)
}

export function getHorizonBaseUrl(network?: StellarNetwork): string {
  if (process.env.STELLAR_HORIZON_URL?.trim()) {
    return process.env.STELLAR_HORIZON_URL.trim().replace(/\/+$/, '')
  }

  const effectiveNetwork = network ?? (process.env.STELLAR_NETWORK as StellarNetwork) ?? 'testnet'
  return effectiveNetwork === 'mainnet'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org'
}

/**
 * Verifies a Stellar transaction against the Horizon API with timeouts and typed errors.
 */
export async function verifyStellarTransaction(
  txHash: string,
  expectedNetwork: StellarNetwork
): Promise<StellarVerificationResult> {
  if (!txHash || !VALID_TX_HASH.test(txHash)) {
    return {
      verified: false,
      error: 'Invalid transaction hash format; must be a 64-character hex string',
    }
  }

  const horizonBase = getHorizonBaseUrl(expectedNetwork)
  const timeoutMs = getHorizonTimeoutMs()
  const path = `/transactions/${txHash}`
  const url = `${horizonBase}${path}`
  const start = Date.now()

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err: unknown) {
    const durationMs = Date.now() - start
    const error = err as Error
    const isTimeout =
      error.name === 'TimeoutError' ||
      error.name === 'AbortError' ||
      (typeof error.message === 'string' && error.message.toLowerCase().includes('timeout'))

    logger.warn('upstream.call.failure', {
      upstream: 'stellar-horizon',
      path,
      durationMs,
      error: error.message,
    })

    if (isTimeout) {
      throw new UpstreamTimeoutError(`Stellar Horizon timed out after ${timeoutMs}ms: ${path}`)
    }
    throw new UpstreamError(`Stellar Horizon request failed: ${error.message}`)
  }

  const durationMs = Date.now() - start
  const status = response.status

  if (status === 404) {
    logger.info('upstream.call.not_found', {
      upstream: 'stellar-horizon',
      path,
      status: 404,
      durationMs,
    })
    return {
      verified: false,
      error: `Transaction not found on Stellar ${expectedNetwork} (pending, expired, or wrong network)`,
    }
  }

  if (!response.ok) {
    let rawText = ''
    try {
      if (typeof response.text === 'function') {
        rawText = await response.text()
      }
    } catch {
      // ignore
    }
    logger.warn('upstream.call.error_response', {
      upstream: 'stellar-horizon',
      path,
      status,
      durationMs,
    })
    throw new UpstreamError(
      `Stellar Horizon returned status ${status}: ${rawText || response.statusText}`
    )
  }

  let txData: {
    successful?: boolean
    ledger?: number
    id?: string
    network?: string
  }

  try {
    if (typeof (response as any).json === 'function') {
      txData = await (response as any).json()
    } else if (typeof response.text === 'function') {
      const raw = await response.text()
      txData = raw ? JSON.parse(raw) : {}
    } else {
      txData = {}
    }
  } catch (err: unknown) {
    logger.warn('upstream.call.invalid_json', {
      upstream: 'stellar-horizon',
      path,
      status,
      durationMs,
      error: (err as Error).message,
    })
    throw new UpstreamError(`Stellar Horizon returned invalid JSON: ${(err as Error).message}`)
  }

  logger.info('upstream.call.success', {
    upstream: 'stellar-horizon',
    path,
    status,
    durationMs,
  })

  if (txData.successful !== true) {
    return {
      verified: false,
      successful: false,
      error: 'Transaction failed on-ledger',
    }
  }

  return {
    verified: true,
    ledger: txData.ledger,
    successful: true,
    networkMatch: true,
  }
}
