'use strict'

/**
 * Trustless Work client: every Trustless Work HTTP call in one place.
 *
 * Base URL and api key come from `getTrustlessWorkApiUrl` /
 * `getTrustlessWorkApiKey` (tw.adapter.ts), which keep the legacy
 * `TRUSTLESS_WORK_API_*` spelling working.
 *
 * Timeout defaults (overridable per call, see `.env.example`):
 *  - indexer read: 30 s. The adapter previously hard-coded 30 s on the
 *    socket; a chunk reads many contracts and `validateOnChain=true`
 *    asks the indexer to check them against the chain, so it gets the
 *    longest budget. `TRUSTLESSWORK_INDEXER_TIMEOUT_MS`.
 *  - `indexer/update-from-txHash`: 15 s. One escrow, one lookup.
 *    `TRUSTLESSWORK_INDEXER_UPDATE_TIMEOUT_MS`.
 *  - `helper/send-transaction`: 15 s. The helper submits the signed
 *    XDR to the network; longer than the plain read is wasted budget,
 *    and a timeout here is ambiguous (the transaction may have been
 *    submitted), so callers reconcile through the confirmation retry
 *    table instead of blindly resending it.
 *    `TRUSTLESSWORK_SEND_TRANSACTION_TIMEOUT_MS`.
 */

import { getTrustlessWorkApiKey, getTrustlessWorkApiUrl } from '../lib/source-adapters/tw.adapter'
import { readTimeoutMs, upstreamRequest } from './http-client'

export const TRUSTLESS_WORK_UPSTREAM = 'trustless-work'

export const DEFAULT_INDEXER_TIMEOUT_MS = 30_000
export const DEFAULT_INDEXER_UPDATE_TIMEOUT_MS = 15_000
export const DEFAULT_SEND_TRANSACTION_TIMEOUT_MS = 15_000

export function getIndexerTimeoutMs(): number {
  return readTimeoutMs('TRUSTLESSWORK_INDEXER_TIMEOUT_MS', DEFAULT_INDEXER_TIMEOUT_MS)
}

export function getIndexerUpdateTimeoutMs(): number {
  return readTimeoutMs('TRUSTLESSWORK_INDEXER_UPDATE_TIMEOUT_MS', DEFAULT_INDEXER_UPDATE_TIMEOUT_MS)
}

export function getSendTransactionTimeoutMs(): number {
  return readTimeoutMs('TRUSTLESSWORK_SEND_TRANSACTION_TIMEOUT_MS', DEFAULT_SEND_TRANSACTION_TIMEOUT_MS)
}

function headers(): Record<string, string> {
  const apiKey = getTrustlessWorkApiKey()
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  }
}

/**
 * Raw indexer read for the given contract ids. The caller normalizes the
 * records; this only fetches them. Throws a typed upstream error on
 * timeout, non-2xx or invalid JSON.
 */
export async function fetchEscrowsByContractIds(contractIds: string[]): Promise<unknown> {
  const params = new URLSearchParams()
  for (const id of contractIds) params.append('contractIds', id)
  params.append('validateOnChain', 'true')

  const url = `${getTrustlessWorkApiUrl()}/helper/get-escrow-by-contract-ids?${params.toString()}`
  const { data } = await upstreamRequest(TRUSTLESS_WORK_UPSTREAM, url, {
    method: 'GET',
    headers: headers(),
    timeoutMs: getIndexerTimeoutMs(),
  })
  return data
}

/** POST `/indexer/update-from-txHash` for a TW-generated transaction. */
export async function updateIndexerFromTxHash(
  txHash: string,
  network: string,
): Promise<void> {
  const url = `${getTrustlessWorkApiUrl()}/indexer/update-from-txHash`
  await upstreamRequest(TRUSTLESS_WORK_UPSTREAM, url, {
    method: 'POST',
    headers: headers(),
    body: { txHash, network },
    timeoutMs: getIndexerUpdateTimeoutMs(),
    parseJson: false,
  })
}

/**
 * POST `/helper/send-transaction` with a signed XDR. Returns the
 * transaction hash when the upstream supplied one.
 *
 * A timeout on this call is ambiguous: the transaction may have been
 * submitted before the response was lost. Callers must NOT blindly
 * resend the XDR; the hash, when it lands, is reconciled through the
 * confirmation retry table (`processPendingConfirmationRetries`).
 */
export async function sendTransaction(
  signedXdr: string,
  network: string,
): Promise<{ txHash?: string }> {
  const url = `${getTrustlessWorkApiUrl()}/helper/send-transaction`
  const { data } = await upstreamRequest<{ txHash?: string; hash?: string }>(TRUSTLESS_WORK_UPSTREAM, url, {
    method: 'POST',
    headers: headers(),
    body: { signedXdr, network },
    timeoutMs: getSendTransactionTimeoutMs(),
  })
  return { txHash: data.txHash || data.hash }
}
