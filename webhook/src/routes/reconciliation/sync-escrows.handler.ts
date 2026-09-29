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
  console.log('[reconciliation] 🔄 Starting escrow sync...')

  try {
    const contractIds = await fetchEscrowContractIds('safetrust')
    const sync = await syncEscrowsWithIndexer(contractIds)
    const drift = await validateSorobanDrift(contractIds, NETWORK)
    const stale = await detectStaleEscrows(STALE_ESCROW_DAYS)
    const summary = formatReconciliationSummary(sync, drift, stale, Date.now() - startTime)

    console.log(`[reconciliation] ✅ Sync complete in ${summary.durationMs}ms`)
    console.log(`   Total escrows     : ${summary.totalEscrows}`)
    console.log(`   Chunks            : ${summary.chunks}`)
    console.log(`   Updated rows      : ${summary.updated}`)
    console.log(`   Unchanged rows    : ${summary.unchanged}`)
    console.log(`   Skipped rows      : ${summary.skipped}`)
    console.log(`   Stale rows        : ${summary.staleCount}`)
    console.log(`   Soroban drift     : ${summary.sorobanDrift}`)
    console.log(`   Soroban corrected : ${summary.sorobanCorrected}`)
    if (summary.errors > 0) {
      console.log(`   Errors            : ${summary.errors}`)
    }

    return ok(res, summary)
  } catch (fatalError) {
    const fErr = fatalError as Error
    console.error('[reconciliation] ❌ Fatal error:', fErr.message)
    return serverError(res, {
      success: false,
      error: 'Reconciliation failed',
      details: fErr.message,
    })
  }
}
