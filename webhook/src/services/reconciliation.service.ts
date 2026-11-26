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
  fetchEscrowTransitionStates,
  findStaleEscrows,
  upsertEscrows,
} from '../repositories/reconciliation.repository'
import { processPendingConfirmationRetries } from './confirmation.service'
import type { ProcessRetriesSummary } from './confirmation.service'
import { CANONICAL_TRANSITIONS, canTransitionStatus } from '../lib/escrow-freshness'
import { executeEscrowLifecycleTransition } from './escrow.service'
import type { EscrowLifecycleParams } from './escrow.service'
import { notifyHotelEscrowConversation } from './hotel-conversation-notify'
import type {
  EscrowRecord,
  ReconciliationTransitionSummary,
  SyncAllResult,
  UpsertResult,
} from '../lib/reconciliation.types'

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

  const counts = await upsertEscrows(escrowsToUpsert)
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

/**
 * Fetch and write every chunk in turn. A failing chunk is recorded in
 * `errors` and never stops the chunks after it.
 */
export async function syncAllChunks(
  contractIds: string[],
  options: ReconcileChunkOptions = {}
): Promise<SyncAllResult> {
  const chunks = chunkArray(contractIds, CHUNK_SIZE)

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
  transitions?: ReconciliationTransitionSummary
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
  retries?: ProcessRetriesSummary,
  transitions?: ReconciliationTransitionSummary
): ReconciliationResponse {
  const effectiveTransitions = transitions ?? sync.transitions
  const totalErrors =
    (sync.errors?.length ?? 0) +
    (retries?.errors?.length ?? 0) +
    (effectiveTransitions?.errors?.length ?? 0)

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
    ...(transitions ? { transitions } : {}),
  }

  if (sync.totalEscrows === 0) {
    response.message = 'No escrows to sync'
  }

  return response
}
