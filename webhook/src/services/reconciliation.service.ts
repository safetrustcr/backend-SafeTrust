'use strict'

/**
 * @file src/services/reconciliation.service.ts
 * @description Core reconciliation service functions for escrow synchronization,
 *              Soroban drift validation, and stale detection.
 *
 * ARCHITECTURAL OVERRIDE RATIONALE (ARCH-A5 / ESC-04):
 * ───────────────────────────────────────────────────
 * SafeTrust lifecycle writers (fund, dispute, resolve, release, approve-milestone)
 * strictly enforce single-step state transition guards via the canonical
 * escrow-state-machine module (e.g., UPDATE ... WHERE status IN ($validStates)),
 * rejecting invalid transitions with StateConflictError.
 *
 * The reconciliation synchronization path (syncAllChunks / UPSERT_ESCROW_SQL in
 * lib/reconciliation.ts) is an EXPLICIT, AUTHORITATIVE OVERRIDE of single-step
 * transition validation.
 *
 * Written Rationale:
 * 1. Authoritative Ledger Truth: Reconciliation ingests state directly from the
 *    authoritative TrustlessWork indexer and Soroban RPC.
 * 2. Multi-Step Convergence: During service downtime, network partitions, or initial
 *    backfills, an escrow contract on Stellar may advance across multiple states
 *    (e.g., created -> funded -> milestone_approved -> completed) while webhooks
 *    were unreceived or processed out-of-order. If reconciliation enforced single-step
 *    transition guards, it would fail to sync, permanently stranding the local
 *    database in stale state and preventing drift convergence.
 * 3. Idempotent Write Protection: The reconciliation UPSERT employs PostgreSQL
 *    IS DISTINCT FROM to ensure identical records produce zero writes (rows_affected = 0)
 *    and prevents overwriting SafeTrust-owned metadata.
 * 4. Guard Isolation: Soroban validation detects discrepancies between DB and on-chain
 *    state without uncontrolled mutations until authoritative read adapters are active.
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
 * Step 1: Fetches all known contract IDs for a given tenant from safetrust.trustless_work_escrows.
 *
 * @param tenantId - Tenant identifier (defaults to 'safetrust')
 * @returns Array of contract IDs
 */
export async function fetchEscrowContractIds(
  tenantId: string = 'safetrust'
): Promise<string[]> {
  const { rows } = await db.query<{ contract_id: string }>(
    `SELECT contract_id
       FROM safetrust.trustless_work_escrows
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

          // Report critical drift only. Database corrections remain disabled
          // until ESC-02 establishes a validated authoritative read adapter.
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
      errors: [],
    }
  }

  const { rows: currentRows } = await db.query<EscrowDbRow>(
    `SELECT contract_id, id, status, balance, marker, approver
       FROM safetrust.trustless_work_escrows
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
            ` ${drifted} contracts with drift; automatic corrections disabled`
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
