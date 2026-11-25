'use strict'

/**
 * @file src/routes/reconciliation/sync-escrows.handler.ts
 * @description POST /reconciliation/sync-escrows — Hasura cron trigger target.
 * Orchestrates escrow synchronization across DB, TrustlessWork indexer, and Soroban.
 */

import { Request, Response } from 'express'
import { ok, serverError } from '../../utils/response'
import {
  fetchEscrowContractIds,
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
import { getPlatformTenantId } from '../../config/tenant'

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
    const tenantId = getPlatformTenantId()
    const contractIds = await fetchEscrowContractIds(tenantId)
    const sync = await syncEscrowsWithIndexer(contractIds, {
      applyTransitions: true,
      tenantId,
    })
    const drift = await validateSorobanDrift(contractIds, NETWORK, {
      tenantId,
      skipStatusCorrectionFor: sync.transitions?.failedContractIds,
    })
    const stale = await detectStaleEscrows(STALE_ESCROW_DAYS, tenantId)
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
  } catch (fatalError) {
    logger.error('reconciliation.sync.failed', { error: fatalError })
    return serverError(res, 'Reconciliation failed')
  }
}
