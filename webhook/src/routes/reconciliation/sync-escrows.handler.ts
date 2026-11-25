'use strict'

/**
 * @file src/routes/reconciliation/sync-escrows.handler.ts
 * @description POST /reconciliation/sync-escrows — Hasura cron trigger target.
 * Orchestrates escrow synchronization between the DB and the TrustlessWork indexer.
 */

import { Request, Response } from 'express'
import { ok, serverError } from '../../utils/response'
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
    const contractIds = await fetchEscrowContractIds('safetrust')
    const sync = await syncEscrowsWithIndexer(contractIds)
    const stale = await detectStaleEscrows(STALE_ESCROW_DAYS)
    const summary = formatReconciliationSummary(sync, stale, Date.now() - startTime)

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
    })

    return ok(res, summary)
  } catch (fatalError) {
    logger.error('reconciliation.sync.failed', { error: fatalError })
    return serverError(res, 'Reconciliation failed')
  }
}
