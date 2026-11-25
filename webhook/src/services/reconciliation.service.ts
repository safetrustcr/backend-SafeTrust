'use strict'

/**
 * @file src/services/reconciliation.service.ts
 * @description Core reconciliation service functions for escrow synchronization
 *              and stale detection.
 *
 * Reconciliation reads at most `CHUNK_SIZE` escrows per indexer request, once
 * every 15 minutes, so each chunk is fetched in turn and written row by row.
 */

import { fetchEscrowsByContractIds } from '../lib/source-adapters/tw.adapter'
import { normalizeIndexerEscrows } from '../lib/source-adapters/tw-indexer.normalize'
import { logger } from '../middleware/logger'
import {
  fetchEscrowContractIds as loadEscrowContractIds,
  findStaleEscrows,
  upsertEscrows,
} from '../repositories/reconciliation.repository'
import { processPendingConfirmationRetries } from './confirmation.service'
import type { ProcessRetriesSummary } from './confirmation.service'
import type { SyncAllResult, UpsertResult } from '../lib/reconciliation.types'

export const CHUNK_SIZE = 50

export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (!Array.isArray(arr)) throw new TypeError('chunkArray: arr must be an array')
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('chunkArray: size must be a positive integer')
  }

  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

/**
 * Normalize raw indexer escrows and write the valid ones. Invalid records are
 * logged and counted as skipped; they never block their siblings.
 */
async function writeIndexerEscrows(raw: unknown[]): Promise<UpsertResult> {
  const { escrows, invalid } = normalizeIndexerEscrows(raw)
  for (const record of invalid) {
    logger.warn('reconciliation.invalid_indexer_escrow', {
      contractId: record.contractId,
      reason: record.reason,
    })
  }
  const counts = await upsertEscrows(escrows)
  return { ...counts, skipped: counts.skipped + invalid.length }
}

export async function syncChunk(contractIds: string[]): Promise<UpsertResult> {
  const escrows = await fetchEscrowsByContractIds(contractIds)
  return writeIndexerEscrows(escrows)
}

/**
 * Fetch and write every chunk in turn. A failing chunk is recorded in
 * `errors` and never stops the chunks after it.
 */
export async function syncAllChunks(contractIds: string[]): Promise<SyncAllResult> {
  const chunks = chunkArray(contractIds, CHUNK_SIZE)

  let updated = 0
  let unchanged = 0
  let skipped = 0
  const errors: string[] = []

  for (let i = 0; i < chunks.length; i++) {
    try {
      const result = await syncChunk(chunks[i])
      updated += result.updated
      unchanged += result.unchanged
      skipped += result.skipped
      console.log(
        `[reconciliation]   chunk ${i + 1}/${chunks.length}` +
          ` (${chunks[i].length} ids) — updated: ${result.updated}, unchanged: ${result.unchanged}, skipped: ${result.skipped}`
      )
    } catch (chunkError) {
      const errMsg = (chunkError as Error).message || String(chunkError)
      console.error(
        `[reconciliation] ⚠️  Chunk ${i + 1}/${chunks.length} failed: ${errMsg}`
      )
      errors.push(`chunk_${i}: ${errMsg}`)
    }
  }

  return { chunks: chunks.length, updated, unchanged, skipped, errors }
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface SyncSummary {
  totalEscrows: number
  chunks: number
  updated: number
  unchanged: number
  skipped: number
  errors: string[]
}

export interface ReconciliationResponse {
  success: boolean
  message?: string
  totalEscrows: number
  chunks: number
  updated: number
  unchanged: number
  skipped: number
  staleCount: number
  staleContractIds: string[]
  errors: number
  durationMs: number
  confirmationRetries?: ProcessRetriesSummary
}

// ─── Extracted Functions ──────────────────────────────────────────────────────

/**
 * Step 1: Fetches all known contract IDs for a given tenant from safetrust.trustless_work_escrows.
 *
 * @param tenantId - Tenant identifier (defaults to 'safetrust')
 * @returns Array of contract IDs
 */
export async function fetchEscrowContractIds(
  tenantId: string = 'safetrust'
): Promise<string[]> {
  return loadEscrowContractIds(tenantId)
}

/**
 * Step 2: Synchronizes escrows against TrustlessWork indexer in chunks.
 *
 * @param contractIds - Array of contract IDs to synchronize
 * @returns Summary of synchronized chunks and record counts
 */
export async function syncEscrowsWithIndexer(
  contractIds: string[]
): Promise<SyncSummary> {
  if (contractIds.length === 0) {
    return {
      totalEscrows: 0,
      chunks: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: [],
    }
  }

  const result = await syncAllChunks(contractIds)
  return {
    totalEscrows: contractIds.length,
    chunks: result.chunks,
    updated: result.updated,
    unchanged: result.unchanged,
    skipped: result.skipped,
    errors: result.errors,
  }
}

/**
 * Step 3: Detects escrows that haven't been updated in `staleDays` days.
 *
 * @param staleDays - Threshold in days for considering an escrow stale (default 7)
 * @returns Array of stale contract IDs
 */
export async function detectStaleEscrows(
  staleDays: number = 7
): Promise<string[]> {
  const staleContractIds = (await findStaleEscrows(staleDays)) || []
  if (staleContractIds.length > 0) {
    console.warn(
      `[reconciliation] ⚠️  ${staleContractIds.length} escrows not updated in ${staleDays}+ days:`,
      staleContractIds.slice(0, 5)
    )
  }
  return staleContractIds
}

/**
 * Step 4: Background sweep that processes durable confirmation retries.
 */
export async function reconcileConfirmationRetries(): Promise<ProcessRetriesSummary> {
  return processPendingConfirmationRetries()
}

/**
 * Step 5: Pure function that formats reconciliation summary results into standard response shape.
 *
 * @param sync - Results from syncing with the indexer
 * @param stale - Array of stale contract IDs
 * @param elapsed - Duration in milliseconds
 * @param retries - Summary of processed confirmation retries (optional)
 * @returns Formatted reconciliation response object
 */
export function formatReconciliationSummary(
  sync: SyncSummary,
  stale: string[],
  elapsed: number,
  retries?: ProcessRetriesSummary
): ReconciliationResponse {
  const totalErrors = (sync.errors?.length ?? 0) + (retries?.errors?.length ?? 0)

  const response: ReconciliationResponse = {
    success: true,
    totalEscrows: sync.totalEscrows,
    chunks: sync.chunks,
    updated: sync.updated,
    unchanged: sync.unchanged,
    skipped: sync.skipped,
    staleCount: stale.length,
    staleContractIds: stale.slice(0, 10),
    errors: totalErrors,
    durationMs: elapsed,
    ...(retries ? { confirmationRetries: retries } : {}),
  }

  if (sync.totalEscrows === 0) {
    response.message = 'No escrows to sync'
  }

  return response
}
