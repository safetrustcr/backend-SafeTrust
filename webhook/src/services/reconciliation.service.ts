'use strict'

/**
 * @file src/services/reconciliation.service.ts
 * @description Core reconciliation service functions for escrow synchronization,
 *              Soroban drift validation, and stale detection.
 */

import { fetchEscrowsByContractIds } from '../lib/source-adapters/tw.adapter'
import { normalizeIndexerEscrows } from '../lib/source-adapters/tw-indexer.normalize'
import { logger } from '../middleware/logger'
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
  fetchEscrowTransitionStates,
  fetchSorobanEscrowRows,
  findStaleEscrows,
  upsertEscrowBatch,
} from '../repositories/reconciliation.repository'
import { hasuraRequest } from './hasura'
import { isRustBulkUpsertEnabled } from '../lib/native-adapters/rust-upsert.adapter'
import { processPendingConfirmationRetries } from './confirmation.service'
import type { ProcessRetriesSummary } from './confirmation.service'
import { CANONICAL_TRANSITIONS, canTransitionStatus } from '../lib/escrow-freshness'
import { executeEscrowLifecycleTransition } from './escrow.service'
import type { EscrowLifecycleParams } from './escrow.service'
import { notifyHotelEscrowConversation } from './hotel-conversation-notify'
import { query } from './db'
import { amountToStroops } from '../lib/stellar-amounts'
import {
  verifyEscrowForReservation,
  recordEscrowVerificationEvent,
  getReservationVerificationData,
} from './escrow-verification'
import { getStellarConfig } from '../config/stellar'
import type {
  ChunkResult,
  ChunkSyncResult,
  EscrowRecord,
  ReconciliationEscrowRow,
  ReconciliationTransitionSummary,
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

export interface ReconciliationTransition {
  contractId: string
  observedStatus: string
  eventType: string
  targetStatus: string
  reservationStatus: string
  amount?: number
  notification?: { eventType: string; body: string }
  observedLedgerSeq?: string | null
}

interface ReconciliationTransitionSpec {
  eventType: string
  targetStatus: string
  reservationStatus: string
  notification?: { eventType: string; body: string }
}

const LIFECYCLE_TRANSITION_SPECS: Record<string, ReconciliationTransitionSpec> = {
  funded: {
    eventType: 'escrow.funded',
    targetStatus: 'funded',
    reservationStatus: 'funded',
    notification: {
      eventType: 'escrow_funded',
      body: 'SafeTrust: Your deposit has been confirmed on the Stellar network. Your booking is secured.',
    },
  },
  completed: {
    eventType: 'funds.released',
    targetStatus: 'completed',
    reservationStatus: 'completed',
    notification: {
      eventType: 'escrow_completed',
      body: 'SafeTrust: Funds have been released. Thank you for booking with us.',
    },
  },
  disputed: {
    eventType: 'dispute.raised',
    targetStatus: 'disputed',
    reservationStatus: 'disputed',
  },
  resolved: {
    eventType: 'dispute.resolved',
    targetStatus: 'resolved',
    reservationStatus: 'resolved',
  },
}

function transitionAmount(targetStatus: string, record: EscrowRecord): number | undefined {
  if (targetStatus === 'funded') {
    const amount = Number(record.amount ?? 0)
    return Number.isFinite(amount) && amount > 0 ? amount : undefined
  }
  if (targetStatus === 'completed' || targetStatus === 'resolved') return 0
  return undefined
}

function observedLedgerSeq(record: EscrowRecord): string | null {
  const seq = record.ledgerSeq ?? record.ledger_seq
  if (seq === undefined || seq === null) return null
  return typeof seq === 'bigint' ? seq.toString() : String(seq)
}

function buildLifecyclePath(from: string, to: string): string[] {
  if (from === to) return []
  const queue: string[][] = [[from]]
  const visited = new Set([from])

  while (queue.length > 0) {
    const path = queue.shift()!
    const current = path[path.length - 1]
    for (const next of CANONICAL_TRANSITIONS[current] ?? []) {
      if (!canTransitionStatus(current, next)) continue
      if (next === to) return [...path.slice(1), next]
      if (!LIFECYCLE_TRANSITION_SPECS[next] || visited.has(next)) continue
      visited.add(next)
      queue.push([...path, next])
    }
  }

  return []
}

export function detectReconciliationTransitions(
  localStates: Array<{ contract_id: string; status?: string }>,
  observedEscrows: EscrowRecord[]
): ReconciliationTransition[] {
  const statusByContract = new Map(
    localStates
      .filter((row) => Boolean(row.contract_id))
      .map((row) => [row.contract_id, row.status])
  )
  const transitions: ReconciliationTransition[] = []

  for (const record of observedEscrows) {
    const observedStatus = record.status
    if (!record.contractId || !observedStatus) continue
    if (!LIFECYCLE_TRANSITION_SPECS[observedStatus]) continue

    const localStatus = statusByContract.get(record.contractId)
    if (!localStatus || localStatus === observedStatus) continue

    const path = buildLifecyclePath(localStatus, observedStatus)
    const seq = observedLedgerSeq(record)
    for (const targetStatus of path) {
      const spec = LIFECYCLE_TRANSITION_SPECS[targetStatus]
      transitions.push({
        contractId: record.contractId,
        observedStatus,
        eventType: spec.eventType,
        targetStatus: spec.targetStatus,
        reservationStatus: spec.reservationStatus,
        amount: transitionAmount(targetStatus, record),
        notification: spec.notification,
        observedLedgerSeq: seq,
      })
    }
  }

  return transitions
}

function parseStroopsAllowZero(value: unknown): bigint | null {
  if (value === null || value === undefined || value === '') return null
  if (value === 0 || value === '0' || value === '0.0' || value === 0n) return 0n
  const stroopStr = amountToStroops(value)
  if (stroopStr !== null) return BigInt(stroopStr)
  return null
}

export interface OnChainVerificationResult {
  verified: boolean
  error?: string
  mismatchType?: 'balance_mismatch' | 'booking_mismatch' | 'unavailable'
}

export async function verifyOnChainEscrowTransition(
  contractId: string,
  targetStatus: string,
  expectedAmount?: number,
  tenantId: string = 'safetrust',
  indexerBalance?: number | string
): Promise<OnChainVerificationResult> {
  const config = getStellarConfig()
  const network = config.network === 'mainnet' ? 'mainnet' : 'testnet'

  let onChainStroops: bigint | null = null

  if (hasSorobanReconciler()) {
    try {
      const rawJson = querySorobanEscrow(contractId, network)
      const sorobanData: any = rawJson ? JSON.parse(rawJson) : null
      if (!sorobanData) {
        return {
          verified: false,
          error: `Failed to query on-chain Soroban escrow data for ${contractId}`,
          mismatchType: 'unavailable',
        }
      }

      onChainStroops = parseStroopsAllowZero(sorobanData.balance)
      if (onChainStroops === null) {
        return {
          verified: false,
          error: `Invalid on-chain balance observation: ${sorobanData.balance}`,
          mismatchType: 'balance_mismatch',
        }
      }

      // If targetStatus is 'funded', verify on-chain balance is >= expected deposit
      if (targetStatus === 'funded' && expectedAmount !== undefined) {
        const expectedStroops = amountToStroops(expectedAmount)
        if (!expectedStroops || onChainStroops < BigInt(expectedStroops)) {
          return {
            verified: false,
            error: `On-chain balance (${onChainStroops} stroops) is less than required deposit (${expectedStroops ?? expectedAmount} stroops)`,
            mismatchType: 'balance_mismatch',
          }
        }
      }
    } catch (err) {
      return {
        verified: false,
        error: `Error querying on-chain Soroban escrow: ${(err as Error).message}`,
        mismatchType: 'unavailable',
      }
    }
  }

  try {
    const escrowRes = await query<{
      id: string
      amount: number
      balance: number
      marker: string
      approver: string
      releaser: string
      resolver: string | null
      asset_code: string | null
      asset_issuer: string | null
      token_contract_id: string | null
    }>(
      `SELECT id, amount, balance, marker, approver, releaser, resolver,
              asset_code, asset_issuer, token_contract_id
       FROM safetrust.trustless_work_escrows
       WHERE contract_id = $1 AND tenant_id = $2
       LIMIT 1`,
      [contractId, tenantId]
    )

    if (!escrowRes.rows || !escrowRes.rows[0]) {
      return {
        verified: false,
        error: `Escrow record not found in database for contract ${contractId}`,
        mismatchType: 'unavailable',
      }
    }

    const row = escrowRes.rows[0]

    // Compare on-chain and indexer balances for protected transitions (funded, completed, resolved)
    if (onChainStroops !== null) {
      const effectiveIndexerBal = indexerBalance !== undefined ? indexerBalance : row.balance
      const indexerStroops = parseStroopsAllowZero(effectiveIndexerBal)
      if (indexerStroops !== null && indexerStroops !== onChainStroops) {
        return {
          verified: false,
          error: `Balance disagreement between on-chain (${onChainStroops} stroops) and indexer (${indexerStroops} stroops)`,
          mismatchType: 'balance_mismatch',
        }
      }
    }

    const resData = await query<{ id: string }>(
      `SELECT id
       FROM safetrust.reservations
       WHERE escrow_id = $1 AND tenant_id = $2
       LIMIT 1`,
      [row.id, tenantId]
    )

    if (!resData.rows || !resData.rows[0]) {
      return {
        verified: false,
        error: `No booking reservation linked to escrow ${row.id}`,
        mismatchType: 'booking_mismatch',
      }
    }

    const reservationTarget = await getReservationVerificationData(resData.rows[0].id)
    if (!reservationTarget) {
      return {
        verified: false,
        error: `Could not load reservation verification target for ${resData.rows[0].id}`,
        mismatchType: 'unavailable',
      }
    }

    const verification = verifyEscrowForReservation(
      {
        id: row.id,
        contract_id: contractId,
        amount: row.amount,
        marker: row.marker,
        approver: row.approver,
        releaser: row.releaser,
        resolver: row.resolver,
        asset_code: row.asset_code ?? 'USDC',
        asset_issuer: row.asset_issuer,
        token_contract_id: row.token_contract_id,
        engagementId: reservationTarget.id,
      },
      reservationTarget,
      {
        phase: 'reconciliation',
      }
    )

    if (!verification.valid) {
      return {
        verified: false,
        error: `Booking verification failed: ${verification.mismatches.join('; ')}`,
        mismatchType: 'booking_mismatch',
      }
    }
  } catch (dbErr) {
    return {
      verified: false,
      error: `Database error during verification: ${(dbErr as Error).message}`,
      mismatchType: 'unavailable',
    }
  }

  return { verified: true }
}

export async function markEscrowUntrusted(
  contractId: string,
  reason: string,
  tenantId: string = 'safetrust'
): Promise<void> {
  try {
    await query(
      `UPDATE safetrust.trustless_work_escrows
       SET status = 'untrusted', updated_at = NOW()
       WHERE contract_id = $1 AND tenant_id = $2`,
      [contractId, tenantId]
    )

    await recordEscrowVerificationEvent({
      contractId,
      result: 'untrusted',
      mismatches: [reason],
      tenantId,
    })
  } catch (err) {
    logger.error('reconciliation.mark_untrusted_failed', { contractId, error: err })
  }
}

export interface ApplyReconciliationTransitionsOptions {
  executeTransition?: (params: EscrowLifecycleParams) => Promise<{
    isDuplicate: boolean
    eventId: string
    escrowId?: string
  }>
  notify?: typeof notifyHotelEscrowConversation
  tenantId?: string
  onFailed?: (contractId: string, error: unknown) => void
}

export async function applyReconciliationTransitions(
  transitions: ReconciliationTransition[],
  options: ApplyReconciliationTransitionsOptions = {}
): Promise<ReconciliationTransitionSummary> {
  const summary: ReconciliationTransitionSummary = {
    detected: transitions.length,
    applied: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
    failedContractIds: [],
  }
  const execute = options.executeTransition ?? executeEscrowLifecycleTransition
  const notify = options.notify ?? notifyHotelEscrowConversation
  const tenantId = options.tenantId ?? 'safetrust'

  for (const transition of transitions) {
    try {
      // Independent on-chain balance & booking verification for money-moving transitions
      if (['funded', 'completed', 'resolved'].includes(transition.targetStatus)) {
        const onChainCheck = await verifyOnChainEscrowTransition(
          transition.contractId,
          transition.targetStatus,
          transition.amount,
          tenantId
        )

        if (!onChainCheck.verified) {
          if (onChainCheck.mismatchType === 'balance_mismatch') {
            // Issue #832: Alert on balance disagreement, leave escrow state unchanged in DB (do NOT mark untrusted)
            logger.warn('reconciliation.balance_disagreement_alert', {
              contractId: transition.contractId,
              targetStatus: transition.targetStatus,
              error: onChainCheck.error,
            })
            summary.failed++
            summary.errors.push(`${transition.contractId}: balance_disagreement - ${onChainCheck.error}`)
            summary.failedContractIds.push(transition.contractId)
            continue
          } else if (onChainCheck.mismatchType === 'booking_mismatch') {
            // Booking or contract role/asset mismatch: mark untrusted
            logger.error('reconciliation.booking_verification_failed', {
              contractId: transition.contractId,
              targetStatus: transition.targetStatus,
              error: onChainCheck.error,
            })
            await markEscrowUntrusted(
              transition.contractId,
              onChainCheck.error ?? 'Booking verification failed',
              tenantId
            )
            summary.failed++
            summary.errors.push(`${transition.contractId}: untrusted - ${onChainCheck.error}`)
            summary.failedContractIds.push(transition.contractId)
            continue
          } else {
            // Verification unavailable (transient DB error, query failure, etc.) - leave unchanged
            logger.warn('reconciliation.verification_unavailable', {
              contractId: transition.contractId,
              error: onChainCheck.error,
            })
            summary.failed++
            summary.errors.push(`${transition.contractId}: verification_unavailable - ${onChainCheck.error}`)
            summary.failedContractIds.push(transition.contractId)
            continue
          }
        }
      }

      const result = await execute({
        contractId: transition.contractId,
        eventType: transition.eventType,
        targetStatus: transition.targetStatus,
        reservationStatus: transition.reservationStatus,
        amount: transition.amount,
        tenantId,
        observedLedgerSeq: transition.observedLedgerSeq,
        rawPayload: {
          contractId: transition.contractId,
          status: transition.targetStatus,
          source: 'reconciliation',
        },
      })

      if (result.isDuplicate) {
        summary.duplicates++
        continue
      }

      summary.applied++
      logger.info('reconciliation.transition_applied', {
        contractId: transition.contractId,
        from: transition.observedStatus,
        status: transition.targetStatus,
        eventId: result.eventId,
      })

      if (transition.notification) {
        const notification = transition.notification
        void notify({
          contractId: transition.contractId,
          eventType: notification.eventType,
          body: notification.body,
        }).catch((error: unknown) => {
          logger.warn('reconciliation.notification_failed', {
            contractId: transition.contractId,
            eventType: notification.eventType,
            error,
          })
        })
      }
    } catch (error) {
      const message = (error as Error).message ?? String(error)
      summary.failed++
      summary.errors.push(`${transition.contractId}: ${message}`)
      summary.failedContractIds.push(transition.contractId)
      options.onFailed?.(transition.contractId, error)
      logger.warn('reconciliation.transition_failed', {
        contractId: transition.contractId,
        status: transition.targetStatus,
        error: message,
      })
    }
  }

  return summary
}

function emptyTransitionSummary(): ReconciliationTransitionSummary {
  return {
    detected: 0,
    applied: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
    failedContractIds: [],
  }
}

function mergeTransitionSummaries(
  target: ReconciliationTransitionSummary,
  source?: ReconciliationTransitionSummary
): void {
  if (!source) return
  target.detected += source.detected
  target.applied += source.applied
  target.duplicates += source.duplicates
  target.failed += source.failed
  target.errors.push(...source.errors)
  for (const contractId of source.failedContractIds) {
    if (!target.failedContractIds.includes(contractId)) target.failedContractIds.push(contractId)
  }
}

interface ObservedStateChangeResult {
  summary: ReconciliationTransitionSummary
  failedContractIds: string[]
}

async function applyObservedStateChanges(
  observedEscrows: EscrowRecord[],
  options: ReconcileChunkOptions = {}
): Promise<ObservedStateChangeResult> {
  if (observedEscrows.length === 0) {
    return { summary: emptyTransitionSummary(), failedContractIds: [] }
  }

  const tenantId = options.tenantId ?? 'safetrust'
  try {
    const localStates = await fetchEscrowTransitionStates(
      observedEscrows.map((record) => record.contractId),
      tenantId
    )
    const failedContractIds = new Set<string>()
    const summary = await applyReconciliationTransitions(
      detectReconciliationTransitions(localStates, observedEscrows),
      {
        tenantId,
        onFailed: (contractId) => failedContractIds.add(contractId),
      }
    )
    return { summary, failedContractIds: [...failedContractIds] }
  } catch (error) {
    const message = (error as Error).message ?? String(error)
    logger.warn('reconciliation.transition_detection_failed', { error: message })
    return {
      summary: {
        ...emptyTransitionSummary(),
        failed: 1,
        errors: [message],
        failedContractIds: observedEscrows.map((record) => record.contractId),
      },
      failedContractIds: observedEscrows.map((record) => record.contractId),
    }
  }
}

export interface ReconcileChunkOptions {
  applyTransitions?: boolean
  tenantId?: string
}

/**
 * Normalize raw indexer escrows and write the valid ones. Invalid records are
 * logged and counted as skipped; they never block their siblings.
 */
async function writeIndexerEscrows(
  raw: unknown[],
  options: ReconcileChunkOptions = {}
): Promise<UpsertResult> {
  const { escrows, invalid } = normalizeIndexerEscrows(raw)
  for (const record of invalid) {
    logger.warn('reconciliation.invalid_indexer_escrow', {
      contractId: record.contractId,
      reason: record.reason,
    })
  }

  let transitions: ReconciliationTransitionSummary | undefined
  let escrowsToUpsert = escrows
  let withheld = 0

  if (options.applyTransitions) {
    const result = await applyObservedStateChanges(escrows, options)
    transitions = result.summary
    if (result.failedContractIds.length > 0) {
      const failed = new Set(result.failedContractIds)
      escrowsToUpsert = escrows.filter((record) => !failed.has(record.contractId))
      withheld = escrows.length - escrowsToUpsert.length
    }
  }

  const counts = await upsertEscrowBatch(escrowsToUpsert)
  return {
    ...counts,
    skipped: counts.skipped + invalid.length + withheld,
    ...(transitions ? { transitions } : {}),
  }
}

export async function syncChunk(
  contractIds: string[],
  options: ReconcileChunkOptions = {}
): Promise<UpsertResult> {
  const escrows = await fetchEscrowsByContractIds(contractIds)
  return writeIndexerEscrows(escrows, options)
}

export async function syncChunksParallel(
  chunks: string[][],
  options: ReconcileChunkOptions = {}
): Promise<ChunkSyncResult> {
  const resultsJson = await processChunksWithRust(chunks)
  const chunkResults: ChunkResult[] = JSON.parse(resultsJson)

  let updated = 0
  let unchanged = 0
  let skipped = 0
  const errors: string[] = []
  const transitions = options.applyTransitions ? emptyTransitionSummary() : undefined

  for (const result of chunkResults) {
    if (result.error) {
      errors.push(`chunk_${result.chunk_index}: ${result.error}`)
      continue
    }
    const counts = await writeIndexerEscrows(result.escrows || [], options)
    updated += counts.updated
    unchanged += counts.unchanged
    skipped += counts.skipped
    mergeTransitionSummaries(transitions!, counts.transitions)
    console.log(
      `[reconciliation]   chunk ${result.chunk_index + 1}/${chunks.length}` +
        ` (${chunks[result.chunk_index]?.length ?? 0} ids, ${result.duration_ms}ms) —` +
        ` updated: ${counts.updated}, unchanged: ${counts.unchanged}, skipped: ${counts.skipped}`
    )
  }

  return {
    updated,
    unchanged,
    skipped,
    errors,
    ...(transitions ? { transitions } : {}),
  }
}

export async function syncAllChunks(
  contractIds: string[],
  options: ReconcileChunkOptions = {}
): Promise<SyncAllResult> {
  const chunks = chunkArray(contractIds, CHUNK_SIZE)
  if (chunks.length === 0) {
    return { chunks: 0, updated: 0, unchanged: 0, skipped: 0, errors: [] }
  }

  if (isRustChunkProcessingEnabled()) {
    try {
      const result = await syncChunksParallel(chunks, options)
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
  const transitions = options.applyTransitions ? emptyTransitionSummary() : undefined

  for (let i = 0; i < chunks.length; i++) {
    try {
      const result = await syncChunk(chunks[i], options)
      updated += result.updated
      unchanged += result.unchanged
      skipped += result.skipped
      mergeTransitionSummaries(transitions!, result.transitions)
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

  return {
    chunks: chunks.length,
    updated,
    unchanged,
    skipped,
    errors,
    ...(transitions ? { transitions } : {}),
  }
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface SyncSummary {
  totalEscrows: number
  chunks: number
  updated: number
  unchanged: number
  skipped: number
  errors: string[]
  transitions?: ReconciliationTransitionSummary
}

export interface SorobanValidationOptions {
  skipStatusCorrectionFor?: Set<string> | string[]
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
  transitions?: ReconciliationTransitionSummary
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
  contractIds: string[],
  options: ReconcileChunkOptions = {}
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

  const result = await syncAllChunks(contractIds, options)
  return {
    totalEscrows: contractIds.length,
    chunks: result.chunks,
    updated: result.updated,
    unchanged: result.unchanged,
    skipped: result.skipped,
    errors: result.errors,
    ...(result.transitions ? { transitions: result.transitions } : {}),
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
  network: string,
  options: SorobanValidationOptions = {}
): Promise<{ drifted: number; corrected: number; unresolved: number }> {
  const skipStatusCorrectionFor = options.skipStatusCorrectionFor instanceof Set
    ? options.skipStatusCorrectionFor
    : new Set(options.skipStatusCorrectionFor ?? [])
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

          const skipStatus = skipStatusCorrectionFor.has(contractId)
          const hasNonStatusCorrection = criticalDiscrepancies.some(
            (discrepancy) => discrepancy.field !== 'status'
          )

          // Auto-correction runs ONLY if explicitly enabled by the operator and state is validated
          if (autoCorrectEnabled && (!skipStatus || hasNonStatusCorrection)) {
            const setClause = skipStatus
              ? `balance:   $balance
                     updatedAt: "now()"`
              : `status:    $status
                     balance:   $balance
                     updatedAt: "now()"`
            const variables = skipStatus
              ? { contractId, balance: onChain.balance / 10_000_000 }
              : {
                  contractId,
                  status: onChain.status,
                  balance: onChain.balance / 10_000_000,
                }
            const statusVariable = skipStatus ? '' : '$status: String!\n                 '

            await hasuraRequest(
              `mutation CorrectDriftFromSoroban(
                 $contractId: String!
                 ${statusVariable}$balance: numeric!
               ) {
                 update_trustless_work_escrows(
                   where: { contractId: { _eq: $contractId } }
                   _set: {
                     ${setClause}
                   }
                 ) { affected_rows }
               }`,
              variables
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
  network: string,
  options: SorobanValidationOptions = {}
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
        network,
        options
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
  retries?: ProcessRetriesSummary,
  transitions?: ReconciliationTransitionSummary
): ReconciliationResponse {
  const effectiveTransitions = transitions ?? sync.transitions
  const totalErrors =
    (sync.errors?.length ?? 0) +
    (drift.errors?.length ?? 0) +
    (retries?.errors?.length ?? 0) +
    (effectiveTransitions?.errors?.length ?? 0)
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
    ...(transitions ? { transitions } : {}),
  }

  if (isNoEscrows) {
    response.message = 'No escrows to sync'
  }


  return response
}
