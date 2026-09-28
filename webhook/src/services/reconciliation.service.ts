'use strict'

/**
 * @file src/services/reconciliation.service.ts
 * @description Core reconciliation service functions for escrow synchronization,
 *              Soroban drift validation, and stale detection.
 */

import db from './db'
import { hasuraRequest } from './hasura'
import {
  syncAllChunks,
  chunkArray,
  CHUNK_SIZE,
  findStaleEscrows,
} from '../lib/reconciliation'

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
  durationMs: number
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

// ─── Native Soroban Addon ─────────────────────────────────────────────────────

let queryEscrowStateBatch: ((contractId: string, network: string) => string) | null = null
let reconcileBatch: ((onChainJson: string, dbJson: string) => string) | null = null

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sorobanReconciler = require('../../../crates/soroban-reconciler')
  queryEscrowStateBatch = sorobanReconciler.queryEscrowStateBatch
  reconcileBatch = sorobanReconciler.reconcileBatch
} catch (err) {
  const error = err as Error
  console.warn(
    '[reconciliation] ⚠️ soroban-reconciler native addon unavailable:',
    error.message
  )
}

/**
 * Allows injecting or replacing Soroban native addon implementations (e.g. for testing).
 */
export function setSorobanReconcilerAddon(addon: {
  queryEscrowStateBatch?: ((contractId: string, network: string) => string) | null
  reconcileBatch?: ((onChainJson: string, dbJson: string) => string) | null
} | null): void {
  if (addon) {
    queryEscrowStateBatch = addon.queryEscrowStateBatch ?? null
    reconcileBatch = addon.reconcileBatch ?? null
  } else {
    queryEscrowStateBatch = null
    reconcileBatch = null
  }
}

// ─── Extracted Functions ──────────────────────────────────────────────────────

/**
 * Step 1: Fetches all known contract IDs for a given tenant from public.trustless_work_escrows.
 *
 * @param tenantId - Tenant identifier (defaults to 'safetrust')
 * @returns Array of contract IDs
 */
export async function fetchEscrowContractIds(
  tenantId: string = 'safetrust'
): Promise<string[]> {
  const { rows } = await db.query<{ contract_id: string }>(
    `SELECT contract_id
       FROM public.trustless_work_escrows
      WHERE tenant_id = $1`,
    [tenantId]
  )
  return rows.map((r) => r.contract_id)
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
 * Detects discrepancies and auto-corrects critical drift in Hasura GraphQL.
 *
 * @param chunk - Batch of contract IDs to reconcile
 * @param dbStateMap - Map of database escrow states indexed by contract ID
 * @param network - Stellar network name (e.g. 'testnet')
 * @returns Counts of drifted and auto-corrected contracts
 */
export async function runSorobanValidation(
  chunk: string[],
  dbStateMap: Record<string, EscrowDbRow>,
  network: string
): Promise<{ drifted: number; corrected: number }> {
  let drifted = 0
  let corrected = 0

  if (!queryEscrowStateBatch || !reconcileBatch) {
    throw new Error('soroban-reconciler native addon is not available')
  }

  for (const contractId of chunk) {
    try {
      // Query Soroban RPC via Rust crate
      const onChainJson = queryEscrowStateBatch(contractId, network)
      const onChain: SorobanOnChainState = JSON.parse(onChainJson)

      const dbState = dbStateMap[contractId]
      if (!dbState) continue

      // Compare via Rust diff engine
      const reportJson = reconcileBatch(
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

          // Auto-correct: update database to match blockchain ground truth
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
    } catch (err) {
      const e = err as Error
      // Per-contract failure is non-fatal inside the Soroban pass
      console.warn(`[reconciliation] ⚠️  Soroban skip for ${contractId}: ${e.message}`)
    }
  }

  return { drifted, corrected }
}

/**
 * Step 3: Validates database escrow states against on-chain Soroban RPC state.
 *
 * @param contractIds - Array of contract IDs to validate
 * @param network - Stellar network name (e.g. 'testnet')
 * @returns Summary of drift and auto-correction counts
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
      errors: [],
    }
  }

  const { rows: currentRows } = await db.query<EscrowDbRow>(
    `SELECT contract_id, id, status, balance, marker, approver
       FROM public.trustless_work_escrows
      WHERE tenant_id = 'safetrust'`
  )
  const dbStateMap = Object.fromEntries(
    currentRows.map((r) => [r.contract_id, r])
  )

  let totalSorobanDrift = 0
  let totalSorobanCorrected = 0
  const errors: string[] = []

  const chunks: string[][] = chunkArray(contractIds, CHUNK_SIZE)
  for (let i = 0; i < chunks.length; i++) {
    try {
      const { drifted, corrected } = await runSorobanValidation(
        chunks[i],
        dbStateMap,
        network
      )
      totalSorobanDrift += drifted
      totalSorobanCorrected += corrected

      if (drifted > 0) {
        console.warn(
          `[reconciliation] ⚠️  Soroban drift in chunk ${i + 1}:` +
            ` ${drifted} contracts, ${corrected} auto-corrected`
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
 * Step 5: Pure function that formats reconciliation summary results into standard response shape.
 *
 * @param sync - Results from syncing with the indexer
 * @param drift - Results from Soroban on-chain drift validation
 * @param stale - Array of stale contract IDs
 * @param elapsed - Duration in milliseconds
 * @returns Formatted reconciliation response object
 */
export function formatReconciliationSummary(
  sync: SyncSummary,
  drift: DriftSummary,
  stale: string[],
  elapsed: number
): ReconciliationResponse {
  const totalErrors = (sync.errors?.length ?? 0) + (drift.errors?.length ?? 0)
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
    durationMs: elapsed,
  }

  if (isNoEscrows) {
    response.message = 'No escrows to sync'
  }

  return response
}
