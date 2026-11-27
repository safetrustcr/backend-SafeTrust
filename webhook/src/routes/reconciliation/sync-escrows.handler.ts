'use strict'

/**
 * @file src/routes/reconciliation/sync-escrows.handler.ts
 * @description POST /reconciliation/sync-escrows — Hasura cron trigger target.
 * Orchestrates escrow synchronization across DB, TrustlessWork indexer, and Soroban.
 */

import { Request, Response } from 'express'
import { ok } from '../../utils/response'
import {
  fetchEscrowContractIds,
  listReconciliationTenants,
  syncEscrowsWithIndexer,
  validateSorobanDrift,
  detectStaleEscrows,
  formatReconciliationSummary,
  SyncSummary,
  DriftSummary,
  ReconciliationResponse,
  runSorobanValidation,
} from '../../services/reconciliation.service'
import { logger } from '../../middleware/logger'

export interface SyncEscrowsPayload {
  [key: string]: unknown
}

export type SyncEscrowsResult = ReconciliationResponse

export {
  runSorobanValidation,
  SyncSummary,
  DriftSummary,
  ReconciliationResponse,
}

const STALE_ESCROW_DAYS = 7
const NETWORK = process.env.STELLAR_NETWORK ?? 'testnet'

/**
 * Handles the POST /reconciliation/sync-escrows trigger from Hasura cron job.
 * Synchronizes database escrow states against TrustlessWork indexer and optional Soroban RPC.
 *
 * The trigger is one platform-wide cron job, but the sync itself runs once
 * per tenant that owns escrow rows (discovered from the escrow table), so
 * escrows owned by non-default tenants such as `hotel_industry` are
 * reconciled too instead of only the platform tenant's.
 *
 * @param req - Express request
 * @param res - Express response
 * @returns JSON summary of the reconciliation sync run
 */
export const syncEscrowsHandler = async (
  req: Request<{}, {}, SyncEscrowsPayload>,
  res: Response
): Promise<Response> => {
  const startTime = Date.now()
  logger.info('reconciliation.sync.started')

  const tenantIds = await listReconciliationTenants()

  const syncTotals: SyncSummary = {
    totalEscrows: 0,
    chunks: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
  }
  const driftTotals: DriftSummary = {
    enabled: false,
    drift: 0,
    corrected: 0,
    unresolved: 0,
    errors: [],
  }
  const transitionsTotals: NonNullable<SyncSummary['transitions']> = {
    detected: 0,
    applied: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
    failedContractIds: [],
  }
  const staleIds: string[] = []

  for (const tenantId of tenantIds) {
    try {
      const contractIds = await fetchEscrowContractIds(tenantId)
      const sync = await syncEscrowsWithIndexer(contractIds, {
        applyTransitions: true,
        tenantId,
      })
      const drift = await validateSorobanDrift(contractIds, NETWORK, {
        skipStatusCorrectionFor: sync.transitions?.failedContractIds,
        tenantId,
      })
      const stale = await detectStaleEscrows(STALE_ESCROW_DAYS, tenantId)

      syncTotals.totalEscrows += sync.totalEscrows
      syncTotals.chunks += sync.chunks
      syncTotals.updated += sync.updated
      syncTotals.unchanged += sync.unchanged
      syncTotals.skipped += sync.skipped
      syncTotals.errors.push(...sync.errors)
      driftTotals.enabled = driftTotals.enabled || drift.enabled
      driftTotals.drift += drift.drift
      driftTotals.corrected += drift.corrected
      driftTotals.unresolved =
        (driftTotals.unresolved ?? 0) + (drift.unresolved ?? 0)
      driftTotals.errors.push(...drift.errors)
      staleIds.push(...stale)
      if (sync.transitions) {
        transitionsTotals.detected += sync.transitions.detected
        transitionsTotals.applied += sync.transitions.applied
        transitionsTotals.duplicates += sync.transitions.duplicates
        transitionsTotals.failed += sync.transitions.failed
        transitionsTotals.errors.push(...sync.transitions.errors)
        for (const contractId of sync.transitions.failedContractIds) {
          if (!transitionsTotals.failedContractIds.includes(contractId)) {
            transitionsTotals.failedContractIds.push(contractId)
          }
        }
      }
    } catch (error) {
      const message = (error as Error).message ?? String(error)
      logger.error('reconciliation.sync.tenant_failed', { tenantId, error: message })
      syncTotals.errors.push(`tenant ${tenantId}: ${message}`)
    }
  }

  const summary = formatReconciliationSummary(
    syncTotals,
    driftTotals,
    staleIds,
    Date.now() - startTime,
    undefined,
    transitionsTotals
  )

  const level = summary.errors > 0 ? 'warn' : 'info'
  logger[level]('reconciliation.sync.completed', {
    durationMs: summary.durationMs,
    totalEscrows: summary.totalEscrows,
    chunks: summary.chunks,
    updated: summary.updated,
    unchanged: summary.unchanged,
    skipped: summary.skipped,
    stale: summary.staleCount,
    sorobanDrift: summary.sorobanDrift,
    sorobanCorrected: summary.sorobanCorrected,
    errors: summary.errors,
    ...(summary.transitions ? { transitions: summary.transitions } : {}),
  })

  return ok(res, summary)
}
