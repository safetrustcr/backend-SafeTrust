'use strict'

/**
 * @file src/routes/reconciliation/sync-escrows.handler.ts
 * @description POST /reconciliation/sync-escrows — Hasura cron trigger target.
 * Orchestrates escrow synchronization between the DB and the TrustlessWork indexer.
 */

import { Request, Response } from 'express'
import { ok } from '../../utils/response'
import {
  fetchEscrowContractIds,
  syncEscrowsWithIndexer,
  detectStaleEscrows,
  formatReconciliationSummary,
  SyncSummary,
  ReconciliationResponse,
} from '../../services/reconciliation.service'
import { logger } from '../../middleware/logger'

export interface SyncEscrowsPayload {
  [key: string]: unknown
}

export type SyncEscrowsResult = ReconciliationResponse

export { SyncSummary, ReconciliationResponse }

const STALE_ESCROW_DAYS = 7
const TENANT_ID = 'safetrust'

/**
 * Handles the POST /reconciliation/sync-escrows trigger from Hasura cron job.
 * Synchronizes database escrow states against the TrustlessWork indexer.
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

  try {
    const contractIds = await fetchEscrowContractIds(TENANT_ID)
    const sync = await syncEscrowsWithIndexer(contractIds, {
      applyTransitions: true,
      tenantId: TENANT_ID,
    })
    const stale = await detectStaleEscrows(STALE_ESCROW_DAYS)
    const summary = formatReconciliationSummary(
      sync,
      stale,
      Date.now() - startTime,
      undefined,
      sync.transitions
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
      errors: summary.errors,
      ...(summary.transitions ? { transitions: summary.transitions } : {}),
    })
  const contractIds = await fetchEscrowContractIds(TENANT_ID)
  const sync = await syncEscrowsWithIndexer(contractIds, {
    applyTransitions: true,
    tenantId: TENANT_ID,
  })
  const drift = await validateSorobanDrift(contractIds, NETWORK, {
    skipStatusCorrectionFor: sync.transitions?.failedContractIds,
  })
  const stale = await detectStaleEscrows(STALE_ESCROW_DAYS)
  const summary = formatReconciliationSummary(
    sync,
    drift,
    stale,
    Date.now() - startTime,
    undefined,
    sync.transitions
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
