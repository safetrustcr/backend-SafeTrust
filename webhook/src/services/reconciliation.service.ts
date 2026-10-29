'use strict'

/**
 * @file src/services/reconciliation.service.ts
 * @description Core reconciliation service functions for escrow synchronization,
 *              Soroban drift validation, and stale detection.
 */

import { fetchEscrowsByContractIds } from '../lib/source-adapters/tw.adapter'
import {
  isRustChunkProcessingEnabled,
  processChunksWithRust,
} from '../lib/native-adapters/rust-chunk.adapter'
import {
  hasSorobanReconciler,
  querySorobanEscrow,
  reconcileSorobanState,
  setSorobanReconcilerAddon,
} from '../lib/source-adapters/soroban.adapter'
import {
  fetchEscrowContractIds as loadEscrowContractIds,
  fetchSorobanEscrowRows,
  findStaleEscrows,
  upsertEscrowBatch,
} from '../repositories/reconciliation.repository'
import { hasuraRequest } from './hasura'
import { isRustBulkUpsertEnabled } from '../lib/native-adapters/rust-upsert.adapter'
import { processPendingConfirmationRetries } from './confirmation.service'
import type { ProcessRetriesSummary } from './confirmation.service'
import type {
  ChunkResult,
  ChunkSyncResult,
  ReconciliationEscrowRow,
  SyncAllResult,
  UpsertResult,
} from '../lib/reconciliation.types'

export { isRustBulkUpsertEnabled, setSorobanReconcilerAddon }

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

export async function syncChunk(contractIds: string[]): Promise<UpsertResult> {
  const escrows = await fetchEscrowsByContractIds(contractIds)
  return upsertEscrowBatch(escrows)
}

export async function syncChunksParallel(chunks: string[][]): Promise<ChunkSyncResult> {
  const resultsJson = await processChunksWithRust(chunks)
  const chunkResults: ChunkResult[] = JSON.parse(resultsJson)

  let updated = 0
  let unchanged = 0
  let skipped = 0
  const errors: string[] = []

  for (const result of chunkResults) {
    if (result.error) {
      errors.push(`chunk_${result.chunk_index}: ${result.error}`)
      continue
    }
    const counts = await upsertEscrowBatch(result.escrows || [])
    updated += counts.updated
    unchanged += counts.unchanged
    skipped += counts.skipped
    console.log(
      `[reconciliation]   chunk ${result.chunk_index + 1}/${chunks.length}` +
        ` (${chunks[result.chunk_index]?.length ?? 0} ids, ${result.duration_ms}ms) —` +
        ` updated: ${counts.updated}, unchanged: ${counts.unchanged}, skipped: ${counts.skipped}`
    )
  }

  return { updated, unchanged, skipped, errors }
}

export async function syncAllChunks(contractIds: string[]): Promise<SyncAllResult> {
  const chunks = chunkArray(contractIds, CHUNK_SIZE)
  if (chunks.length === 0) {
    return { chunks: 0, updated: 0, unchanged: 0, skipped: 0, errors: [] }
  }

  if (isRustChunkProcessingEnabled()) {
    try {
      const result = await syncChunksParallel(chunks)
      return { chunks: chunks.length, ...result }
    } catch (err) {
      console.error(
        `[reconciliation] ⚠️  Parallel chunk path failed, using sequential: ${(err as Error).message}`
      )
    }
  }

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

export interface DriftSummary {
  enabled: boolean
  drift: number
  corrected: number
  unresolved?: number
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
  sorobanEnabled: boolean
  sorobanDrift: number
  sorobanCorrected: number
  sorobanUnresolved?: number
  durationMs: number
  confirmationRetries?: ProcessRetriesSummary
}


export interface EscrowDbRow {
  contract_id: string
  id?: string
  status?: string
  balance?: string
  marker?: string
  approver?: string
}

export interface SorobanOnChainState {
  status: string
  balance: number
}

export interface Discrepancy {
  field: string
  severity: string
  in_database: string
  on_chain: string
}

export interface ReconciliationReport {
  in_sync: boolean
  discrepancies: Discrepancy[]
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
 * Validates a chunk of escrow contracts against on-chain Soroban state via native Rust addon.
 * Detects discrepancies and reports critical drift without modifying Hasura state.
 *
 * @param chunk - Batch of contract IDs to reconcile
 * @param dbStateMap - Map of database escrow states indexed by contract ID
 * @param network - Stellar network name (e.g. 'testnet')
 * @returns Counts of drifted and corrected contracts (corrections remain disabled).
 */
export async function runSorobanValidation(
  chunk: string[],
  dbStateMap: Record<string, EscrowDbRow>,
  network: string
): Promise<{ drifted: number; corrected: number; unresolved: number }> {
  let drifted = 0
  let corrected = 0
  let unresolved = 0

  if (!hasSorobanReconciler()) {
    throw new Error('soroban-reconciler native addon is not available')
  }

  // Automatic corrections that depended on fabricated values are disabled.
  // In production, automatic overwrite is disabled by default (SOROBAN_AUTO_CORRECT_ENABLED=false)
  // to enforce the "preserve last confirmed" rule and prevent data corruption (Security finding F1).
  const autoCorrectEnabled = process.env.SOROBAN_AUTO_CORRECT_ENABLED === 'true'

  for (const contractId of chunk) {
    try {
      // Query validated Soroban / TW adapter via Rust crate
      const onChainJson = querySorobanEscrow(contractId, network)
      const onChain: SorobanOnChainState = JSON.parse(onChainJson)

      const dbState = dbStateMap[contractId]
      if (!dbState) continue

      // Compare via Rust diff engine with exact amounts
      const reportJson = reconcileSorobanState(
        JSON.stringify(onChain),
        JSON.stringify({
          id: dbState.id ?? '',
          contractId: dbState.contract_id,
          status: dbState.status,
          balance: parseFloat(dbState.balance ?? '0'),
          marker: dbState.marker ?? '',
          approver: dbState.approver ?? '',
        })
      )
      const report: ReconciliationReport = JSON.parse(reportJson)

      if (!report.in_sync) {
        drifted++

        const criticalDiscrepancies = report.discrepancies.filter(
          (d) => d.severity === 'critical'
        )

        if (criticalDiscrepancies.length > 0) {
          console.warn(
            `[reconciliation] 🚨 Soroban drift for ${contractId}:`,
            criticalDiscrepancies.map(
              (d) => `${d.field}: ${d.in_database} → ${d.on_chain}`
            )
          )

          // Auto-correction runs ONLY if explicitly enabled by the operator and state is validated
          if (autoCorrectEnabled) {
            await hasuraRequest(
              `mutation CorrectDriftFromSoroban(
                 $contractId: String!
                 $status: String!
                 $balance: numeric!
               ) {
                 update_trustless_work_escrows(
                   where: { contractId: { _eq: $contractId } }
                   _set: {
                     status:    $status
                     balance:   $balance
                     updatedAt: "now()"
                   }
                 ) { affected_rows }
               }`,
              {
                contractId,
                status: onChain.status,
                balance: onChain.balance / 10_000_000,
              }
            )
            corrected++
          }
        }
      }
    } catch (err) {
      const e = err as Error
      unresolved++
      // "Preserve last confirmed" rule: when authoritative state cannot be established,
      // the last DB-confirmed value is kept as-is and flagged as unresolved — never invented.
      console.warn(
        `[reconciliation] ⚠️  Unresolved escrow ${contractId} (preserved last confirmed DB value): ${e.message}`
      )
    }
  }

  return { drifted, corrected, unresolved }
}

/**
 * Step 3: Validates database escrow states against on-chain Soroban RPC state.
 *
 * @param contractIds - Array of contract IDs to validate
 * @param network - Stellar network name (e.g. 'testnet')
 * @returns Summary of detected drift; no automatic database corrections are performed
 */
export async function validateSorobanDrift(
  contractIds: string[],
  network: string
): Promise<DriftSummary> {
  const sorobanValidationEnabled = process.env.SOROBAN_VALIDATION_ENABLED === 'true'

  if (!sorobanValidationEnabled || contractIds.length === 0) {
    return {
      enabled: sorobanValidationEnabled,
      drift: 0,
      corrected: 0,
      unresolved: 0,
      errors: [],
    }
  }

  const currentRows = await fetchSorobanEscrowRows()
  const dbStateMap = Object.fromEntries(
    currentRows.map((r) => [r.contract_id, r])
  )

  let totalSorobanDrift = 0
  let totalSorobanCorrected = 0
  let totalSorobanUnresolved = 0
  const errors: string[] = []

  const chunks: string[][] = chunkArray(contractIds, CHUNK_SIZE)
  for (let i = 0; i < chunks.length; i++) {
    try {
      const { drifted, corrected, unresolved } = await runSorobanValidation(
        chunks[i],
        dbStateMap,
        network
      )
      totalSorobanDrift += drifted
      totalSorobanCorrected += corrected
      totalSorobanUnresolved += unresolved

      if (drifted > 0) {
        console.warn(
          `[reconciliation] ⚠️  Soroban drift in chunk ${i + 1}:` +
            ` ${drifted} contracts, ${corrected} auto-corrected, ${unresolved} unresolved`
        )
      }
    } catch (sorobanError) {
      const sErr = sorobanError as Error
      console.error(
        `[reconciliation] ⚠️  Soroban validation failed for chunk ${i + 1}:`,
        sErr.message
      )
      errors.push(`soroban_chunk_${i + 1}: ${sErr.message}`)
    }
  }

  return {
    enabled: true,
    drift: totalSorobanDrift,
    corrected: totalSorobanCorrected,
    unresolved: totalSorobanUnresolved,
    errors,
  }
}

/**
 * Step 4: Detects escrows that haven't been updated in `staleDays` days.
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
 * Step 5: Background sweep that processes durable confirmation retries.
 */
export async function reconcileConfirmationRetries(): Promise<ProcessRetriesSummary> {
  return processPendingConfirmationRetries()
}

/**
 * Step 6: Pure function that formats reconciliation summary results into standard response shape.
 *
 * @param sync - Results from syncing with the indexer
 * @param drift - Results from Soroban on-chain drift validation
 * @param stale - Array of stale contract IDs
 * @param elapsed - Duration in milliseconds
 * @param retries - Summary of processed confirmation retries (optional)
 * @returns Formatted reconciliation response object
 */
export function formatReconciliationSummary(
  sync: SyncSummary,
  drift: DriftSummary,
  stale: string[],
  elapsed: number,
  retries?: ProcessRetriesSummary
): ReconciliationResponse {
  const totalErrors =
    (sync.errors?.length ?? 0) +
    (drift.errors?.length ?? 0) +
    (retries?.errors?.length ?? 0)
  const isNoEscrows = sync.totalEscrows === 0

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
    sorobanEnabled: drift.enabled,
    sorobanDrift: drift.drift,
    sorobanCorrected: drift.corrected,
    sorobanUnresolved: drift.unresolved ?? 0,
    durationMs: elapsed,
    ...(retries ? { confirmationRetries: retries } : {}),
  }

  if (isNoEscrows) {
    response.message = 'No escrows to sync'
  }


  return response
}
