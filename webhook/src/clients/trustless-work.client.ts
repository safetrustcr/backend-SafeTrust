'use strict'

import { logger } from '../middleware/logger'
import { UpstreamError, UpstreamTimeoutError } from '../utils/errors'
import { getTrustlessWorkApiKey, getTrustlessWorkApiUrl } from '../lib/source-adapters/tw.adapter'
import { VALID_TX_HASH } from './stellar.client'
import type { TwIndexerEscrow } from '../lib/source-adapters/tw-indexer.types'
import type { StellarNetwork } from '../services/confirmation.service'

// ── Timeout Configurations ───────────────────────────────────────────────────

function parseTimeout(val: string | undefined, defaultMs: number): number {
  if (!val) return defaultMs
  const parsed = parseInt(val, 10)
  return isNaN(parsed) || parsed <= 0 ? defaultMs : parsed
}

export function getIndexerTimeoutMs(): number {
  return parseTimeout(
    process.env.TRUSTLESSWORK_INDEXER_TIMEOUT_MS ?? process.env.TRUSTLESSWORK_TIMEOUT_MS,
    30_000
  )
}

export function getSendTxTimeoutMs(): number {
  return parseTimeout(
    process.env.TRUSTLESSWORK_SEND_TX_TIMEOUT_MS ?? process.env.TRUSTLESSWORK_TIMEOUT_MS,
    15_000
  )
}

export function getUpdateTimeoutMs(): number {
  return parseTimeout(
    process.env.TRUSTLESSWORK_UPDATE_TIMEOUT_MS ?? process.env.TRUSTLESSWORK_TIMEOUT_MS,
    15_000
  )
}

// ── Shared HTTP Transport ────────────────────────────────────────────────────

export async function trustlessWorkRequest<T>(
  path: string,
  options: {
    method?: string
    body?: unknown
    timeoutMs: number
    expectJson?: boolean
  }
): Promise<T> {
  const baseUrl = getTrustlessWorkApiUrl()
  const apiKey = getTrustlessWorkApiKey()
  const formattedPath = path.startsWith('/') ? path : `/${path}`
  const url = `${baseUrl}${formattedPath}`
  const method = options.method ?? 'GET'
  const expectJson = options.expectJson ?? true
  const start = Date.now()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey) {
    headers['x-api-key'] = apiKey
  }

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch (err: unknown) {
    const durationMs = Date.now() - start
    const error = err as Error
    const isTimeout =
      error.name === 'TimeoutError' ||
      error.name === 'AbortError' ||
      (typeof error.message === 'string' && error.message.toLowerCase().includes('timeout'))

    logger.warn('upstream.call.failure', {
      upstream: 'trustless-work',
      path: formattedPath,
      durationMs,
      error: error.message,
    })

    if (isTimeout) {
      throw new UpstreamTimeoutError(
        `Trustless Work API timed out after ${options.timeoutMs}ms: ${formattedPath}`
      )
    }
    throw new UpstreamError(`Trustless Work API request failed: ${error.message}`)
  }

  const durationMs = Date.now() - start
  const status = response.status

  if (!response.ok) {
    let rawText = ''
    try {
      if (typeof response.text === 'function') {
        rawText = await response.text()
      }
    } catch {
      // non-critical read failure
    }

    logger.warn('upstream.call.error_response', {
      upstream: 'trustless-work',
      path: formattedPath,
      status,
      durationMs,
    })

    throw new UpstreamError(
      `Trustless Work API responded with status ${status}: ${rawText || response.statusText}`
    )
  }

  if (!expectJson) {
    logger.info('upstream.call.success', {
      upstream: 'trustless-work',
      path: formattedPath,
      status,
      durationMs,
    })
    return {} as T
  }

  try {
    let parsed: T
    if (typeof (response as any).json === 'function') {
      parsed = await (response as any).json()
    } else if (typeof response.text === 'function') {
      const raw = await response.text()
      parsed = (raw ? JSON.parse(raw) : {}) as T
    } else {
      parsed = {} as T
    }

    logger.info('upstream.call.success', {
      upstream: 'trustless-work',
      path: formattedPath,
      status,
      durationMs,
    })
    return parsed
  } catch (err: unknown) {
    const error = err as Error
    logger.warn('upstream.call.invalid_json', {
      upstream: 'trustless-work',
      path: formattedPath,
      status,
      durationMs,
      error: error.message,
    })
    throw new UpstreamError(`Failed to parse Trustless Work API response: ${error.message}`)
  }
}

// ── Client Methods ───────────────────────────────────────────────────────────

/**
 * Trustless Work V1 indexer query (`GET /helper/get-escrow-by-contract-ids`).
 */
export async function fetchIndexerEscrows(contractIds: string[]): Promise<TwIndexerEscrow[]> {
  const params = new URLSearchParams()
  for (const id of contractIds) params.append('contractIds', id)
  params.append('validateOnChain', 'true')
  const path = `/helper/get-escrow-by-contract-ids?${params.toString()}`

  const data = await trustlessWorkRequest<unknown>(path, {
    method: 'GET',
    timeoutMs: getIndexerTimeoutMs(),
    expectJson: true,
  })

  if (Array.isArray(data)) return data as TwIndexerEscrow[]
  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).escrows)) {
    return (data as Record<string, unknown>).escrows as TwIndexerEscrow[]
  }

  throw new UpstreamError(
    `Unexpected TrustlessWork API response shape: ${JSON.stringify(data).slice(0, 200)}`
  )
}

/**
 * Trustless Work transaction submission helper (`POST /helper/send-transaction`).
 */
export async function sendTransactionViaHelper(
  signedXdr: string,
  network: StellarNetwork
): Promise<{ success: boolean; txHash?: string; isTimeout?: boolean; error?: string }> {
  try {
    const data = await trustlessWorkRequest<Record<string, unknown>>('/helper/send-transaction', {
      method: 'POST',
      body: { signedXdr, network },
      timeoutMs: getSendTxTimeoutMs(),
      expectJson: true,
    })
    const candidates = [data?.txHash, data?.hash, data?.transactionHash]
    const txHash = candidates.find(
      (h): h is string => typeof h === 'string' && VALID_TX_HASH.test(h.trim())
    )?.trim()

    if (!txHash) {
      return {
        success: false,
        error: 'TW helper response did not include transaction hash',
      }
    }
    return {
      success: true,
      txHash,
    }
  } catch (err: unknown) {
    const error = err as Error
    const isTimeout =
      error instanceof UpstreamTimeoutError ||
      error.name === 'TimeoutError' ||
      error.name === 'AbortError' ||
      (typeof error.message === 'string' && error.message.toLowerCase().includes('timeout'))

    return {
      success: false,
      isTimeout,
      error: error.message.replace('Trustless Work API responded with status', 'TW helper returned status'),
    }
  }
}

/**
 * Trustless Work indexer update (`POST /indexer/update-from-txHash`).
 */
export async function updateIndexerFromTxHash(
  txHash: string,
  network: StellarNetwork
): Promise<{ success: boolean; error?: string }> {
  try {
    await trustlessWorkRequest<unknown>('/indexer/update-from-txHash', {
      method: 'POST',
      body: { txHash, network },
      timeoutMs: getUpdateTimeoutMs(),
      expectJson: false,
    })
    return { success: true }
  } catch (err: unknown) {
    const error = err as Error
    return {
      success: false,
      error: error.message.replace('Trustless Work API responded with status', 'TW indexer returned status'),
    }
  }
}
