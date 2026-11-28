'use strict'

/**
 * Stellar Horizon client: one transaction lookup, cached base URL.
 *
 * The Horizon base URL is chosen once per call from `STELLAR_NETWORK`
 * (default `testnet`) instead of being spelled out inline wherever a
 * lookup happens. `HORIZON_BASE_URL` overrides it entirely, for
 * self-hosted Horizon instances.
 *
 * Timeout: `HORIZON_TIMEOUT_MS`, default 10 s. Horizon serves a single
 * record by hash, so it is the cheapest call in the system.
 */

import { readTimeoutMs, upstreamRequest } from './http-client'

export const STELLAR_UPSTREAM = 'stellar-horizon'

export const DEFAULT_HORIZON_TIMEOUT_MS = 10_000

export type StellarNetworkName = 'testnet' | 'mainnet'

export function getHorizonBaseUrl(network?: StellarNetworkName): string {
  const override = process.env.HORIZON_BASE_URL?.trim()
  if (override) return override.replace(/\/+$/, '')

  const chosen = network ?? (process.env.STELLAR_NETWORK?.trim() === 'mainnet' ? 'mainnet' : 'testnet')
  return chosen === 'mainnet'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org'
}

export function getHorizonTimeoutMs(): number {
  return readTimeoutMs('HORIZON_TIMEOUT_MS', DEFAULT_HORIZON_TIMEOUT_MS)
}

export interface HorizonTransaction {
  successful?: boolean
  ledger?: number
  id?: string
  network?: string
}

/**
 * Fetch one transaction by hash. Returns the parsed record, or null
 * when Horizon answers 404 (pending, expired, or on the other network).
 * Timeouts and 5xx responses throw typed upstream errors.
 */
export async function getTransactionByHash(
  txHash: string,
  network?: StellarNetworkName,
): Promise<HorizonTransaction | null> {
  const url = `${getHorizonBaseUrl(network)}/transactions/${txHash}`
  try {
    const { data } = await upstreamRequest<HorizonTransaction>(STELLAR_UPSTREAM, url, {
      method: 'GET',
      timeoutMs: getHorizonTimeoutMs(),
    })
    return data
  } catch (error) {
    // A 404 is an answer, not an upstream failure: the transaction is
    // not on this network yet. `upstreamRequest` surfaces it as an
    // UpstreamError carrying the status code.
    const status = (error as { upstreamStatus?: unknown }).upstreamStatus
    if (status === 404) return null
    throw error
  }
}
