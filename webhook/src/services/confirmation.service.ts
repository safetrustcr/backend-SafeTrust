'use strict'

/**
 * @file src/services/confirmation.service.ts
 * @description Core transaction confirmation, verification, Trustless Work indexing,
 *              and durable PostgreSQL retry mechanism for escrow transactions.
 */

import crypto from 'crypto'
import db from './db'
import { hasuraRequest } from './hasura'
import {
  verifyStellarTransaction,
  type StellarVerificationResult,
  VALID_TX_HASH,
} from '../clients/stellar.client'
import {
  sendTransactionViaHelper,
  updateIndexerFromTxHash,
} from '../clients/trustless-work.client'

export { verifyStellarTransaction, type StellarVerificationResult, VALID_TX_HASH }

// ── Types & Constants ─────────────────────────────────────────────────────────

export type LifecycleStage =
  | 'xdr_issued'
  | 'pending_confirmation'
  | 'ledger_confirmed'
  | 'tw_indexed'
  | 'confirmed'

export type EscrowAction = 'deploy' | 'fund'
export type SubmissionPath = 'helper' | 'external'
export type StellarNetwork = 'testnet' | 'mainnet'
export type RetryStatus = 'retrying' | 'dead_letter' | 'completed'

export const MAX_ATTEMPTS = 5
export const BASE_RETRY_DELAY_MS = 1000
export const MAX_RETRY_DELAY_MS = 300_000 // 5 minutes

export interface ConfirmationRetryRecord {
  id: string
  txHash: string
  escrowId: string
  escrowAction: EscrowAction
  network: StellarNetwork
  submissionPath: SubmissionPath
  status: RetryStatus
  attemptCount: number
  maxAttempts: number
  nextRetryAt: string
  lastError: string | null
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ConfirmationResult {
  success: boolean
  stage: LifecycleStage
  txHash: string
  escrowId: string
  action: EscrowAction
  network: StellarNetwork
  submissionPath: SubmissionPath
  retryRecordId?: string
  error?: string
  ledger?: number
  twIndexed?: boolean
  isDuplicate?: boolean
}

export interface ProcessRetriesSummary {
  processed: number
  succeeded: number
  retried: number
  deadLettered: number
  errors: string[]
}

// ── Trustless Work Indexer Synchronization ────────────────────────────────────

/**
 * Calls Trustless Work's indexer/update-from-txHash endpoint.
 * Guardrail: Only callable for TW-generated XDR contexts!
 */
export async function updateTWIndexerFromTxHash(
  txHash: string,
  network: StellarNetwork,
  isTWGenerated: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!isTWGenerated) {
    return {
      success: false,
      error:
        'Guardrail violation: indexer/update-from-txHash can only be called for TW-generated XDRs',
    }
  }

  return updateIndexerFromTxHash(txHash, network)
}

/**
 * Calls Trustless Work's helper/send-transaction endpoint (Path A).
 */
export async function sendTransactionViaTWHelper(
  signedXdr: string,
  network: StellarNetwork
): Promise<{ success: boolean; txHash?: string; isTimeout?: boolean; error?: string }> {
  return sendTransactionViaHelper(signedXdr, network)
}

// ── Bounded Exponential Backoff ───────────────────────────────────────────────

export function calculateBackoffMs(attemptCount: number): number {
  const delay = BASE_RETRY_DELAY_MS * Math.pow(2, Math.max(0, attemptCount - 1))
  return Math.min(delay, MAX_RETRY_DELAY_MS)
}

// ── Database Operations for Retries ───────────────────────────────────────────

export async function upsertRetryRecord(params: {
  txHash: string
  escrowId: string
  action: EscrowAction
  network: StellarNetwork
  submissionPath: SubmissionPath
  status?: RetryStatus
  lastError?: string | null
  attemptCount?: number
  metadata?: Record<string, unknown>
}): Promise<ConfirmationRetryRecord> {
  const status = params.status ?? 'retrying'
  const attemptCount = params.attemptCount ?? 0
  const nextRetryMs = status === 'retrying' ? calculateBackoffMs(attemptCount) : 0

  const { rows } = await db.query<any>(
    `
    INSERT INTO safetrust.escrow_confirmation_retries (
      tx_hash,
      escrow_id,
      escrow_action,
      network,
      submission_path,
      status,
      attempt_count,
      max_attempts,
      next_retry_at,
      last_error,
      metadata,
      tenant_id,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      NOW() + ($9 * INTERVAL '1 millisecond'),
      $10, $11, 'safetrust', NOW()
    )
    ON CONFLICT (tx_hash, escrow_action)
    DO UPDATE SET
      status = EXCLUDED.status,
      last_error = EXCLUDED.last_error,
      attempt_count = EXCLUDED.attempt_count,
      next_retry_at = EXCLUDED.next_retry_at,
      updated_at = NOW()
    RETURNING
      id,
      tx_hash AS "txHash",
      escrow_id AS "escrowId",
      escrow_action AS "escrowAction",
      network,
      submission_path AS "submissionPath",
      status,
      attempt_count AS "attemptCount",
      max_attempts AS "maxAttempts",
      next_retry_at AS "nextRetryAt",
      last_error AS "lastError",
      metadata,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    `,
    [
      params.txHash,
      params.escrowId,
      params.action,
      params.network,
      params.submissionPath,
      status,
      attemptCount,
      MAX_ATTEMPTS,
      nextRetryMs,
      params.lastError ?? null,
      JSON.stringify(params.metadata ?? {}),
    ]
  )

  return rows[0]
}

export async function updateRetryRecordStatus(
  id: string,
  status: RetryStatus,
  attemptCount: number,
  lastError: string | null
): Promise<void> {
  const nextRetryMs = status === 'retrying' ? calculateBackoffMs(attemptCount) : 0

  await db.query(
    `
    UPDATE safetrust.escrow_confirmation_retries
    SET
      status = $1,
      attempt_count = $2,
      last_error = $3,
      next_retry_at = NOW() + ($4 * INTERVAL '1 millisecond'),
      updated_at = NOW()
    WHERE id = $5
    `,
    [status, attemptCount, lastError, nextRetryMs, id]
  )
}

// ── Local Database Promotion ──────────────────────────────────────────────────

/**
 * Promotes local PostgreSQL records once both ledger confirmation and TW indexing succeed.
 * Strictly separates deployment from funding:
 *  - deploy: sets status = 'created' (NOT 'funded'), sets tx_hash, network.
 *  - fund: sets status = 'funded', updates balance = amount, sets tx_hash, network.
 */
export async function promoteEscrowStatus(
  escrowId: string,
  action: EscrowAction,
  txHash: string,
  network: StellarNetwork
): Promise<void> {
  if (action === 'deploy') {
    // Check if contract exists in trustless_work_escrows
    await db.query(
      `
      UPDATE safetrust.trustless_work_escrows
      SET
        status = 'created',
        tx_hash = $1,
        network = $2,
        updated_at = NOW()
      WHERE contract_id = $3
      `,
      [txHash, network, escrowId]
    )

    await db.query(
      `
      UPDATE safetrust.escrow_transactions
      SET
        status = 'deploying',
        tx_hash = $1,
        network = $2,
        updated_at = NOW()
      WHERE contract_id = $3 OR engagement_id = $3
      `,
      [txHash, network, escrowId]
    )
  } else if (action === 'fund') {
    await db.query(
      `
      UPDATE safetrust.trustless_work_escrows
      SET
        status = 'funded',
        balance = amount,
        tx_hash = $1,
        network = $2,
        updated_at = NOW()
      WHERE contract_id = $3
      `,
      [txHash, network, escrowId]
    )

    await db.query(
      `
      UPDATE safetrust.escrow_transactions
      SET
        status = 'funded',
        tx_hash = $1,
        network = $2,
        updated_at = NOW()
      WHERE contract_id = $3 OR engagement_id = $3
      `,
      [txHash, network, escrowId]
    )
  }
}

// ── Main Confirmation Workflows ───────────────────────────────────────────────

/**
 * Path A: Helper Submission Flow (helper/send-transaction)
 */
export async function processHelperSubmission(params: {
  signedXdr: string
  escrowId: string
  action: EscrowAction
  network: StellarNetwork
  isTWGenerated?: boolean
}): Promise<ConfirmationResult> {
  const { signedXdr, escrowId, action, network } = params

  if (!signedXdr || typeof signedXdr !== 'string') {
    return {
      success: false,
      stage: 'xdr_issued',
      txHash: '',
      escrowId,
      action,
      network,
      submissionPath: 'helper',
      error: 'Signed XDR is required for submission',
    }
  }

  // Submit via TW helper
  const sendRes = await sendTransactionViaTWHelper(signedXdr, network)
  if (!sendRes.success || !sendRes.txHash) {
    if (sendRes.isTimeout) {
      const derivedId = crypto.createHash('sha256').update(signedXdr).digest('hex')
      const retryRecord = await upsertRetryRecord({
        txHash: derivedId,
        escrowId,
        action,
        network,
        submissionPath: 'helper',
        status: 'retrying',
        attemptCount: 1,
        metadata: { ambiguousTimeout: true, signedXdr },
      })
      return {
        success: false,
        stage: 'pending_confirmation',
        txHash: derivedId,
        escrowId,
        action,
        network,
        submissionPath: 'helper',
        retryRecordId: retryRecord.id,
        error: `Submission timed out (ambiguous state): ${sendRes.error}`,
      }
    }
    return {
      success: false,
      stage: 'xdr_issued',
      txHash: '',
      escrowId,
      action,
      network,
      submissionPath: 'helper',
      error: sendRes.error ?? 'TW helper failed to submit transaction',
    }
  }

  const txHash = sendRes.txHash

  // Persist pending confirmation and retry record immediately
  const retryRecord = await upsertRetryRecord({
    txHash,
    escrowId,
    action,
    network,
    submissionPath: 'helper',
    status: 'retrying',
    attemptCount: 1,
  })

  // Independently verify ledger execution against the Stellar network
  let ledgerRes: StellarVerificationResult
  try {
    ledgerRes = await verifyStellarTransaction(txHash, network)
  } catch (err: unknown) {
    ledgerRes = { verified: false, error: (err as Error).message }
  }
  if (!ledgerRes.verified) {
    const errorMsg = ledgerRes.error ?? 'Ledger confirmation failed'
    await updateRetryRecordStatus(retryRecord.id, 'retrying', 1, errorMsg)
    return {
      success: false,
      stage: 'pending_confirmation',
      txHash,
      escrowId,
      action,
      network,
      submissionPath: 'helper',
      retryRecordId: retryRecord.id,
      error: errorMsg,
    }
  }

  // Promote SafeTrust DB record
  await promoteEscrowStatus(escrowId, action, txHash, network)
  await updateRetryRecordStatus(retryRecord.id, 'completed', 1, null)

  return {
    success: true,
    stage: 'confirmed',
    txHash,
    escrowId,
    action,
    network,
    submissionPath: 'helper',
    retryRecordId: retryRecord.id,
    ledger: ledgerRes.ledger,
    twIndexed: true,
  }
}

/**
 * Path B: External Submission Flow (Client submits to Stellar, posts txHash)
 */
export async function processExternalSubmission(params: {
  txHash: string
  escrowId: string
  action: EscrowAction
  network: StellarNetwork
  isTWGenerated: boolean
}): Promise<ConfirmationResult> {
  const { txHash, escrowId, action, network, isTWGenerated } = params

  // 1. Validate hash format
  if (!txHash || !VALID_TX_HASH.test(txHash)) {
    return {
      success: false,
      stage: 'xdr_issued',
      txHash: txHash || '',
      escrowId,
      action,
      network,
      submissionPath: 'external',
      error: 'Invalid transaction hash format; must be a 64-character hex string',
    }
  }

  // 2. Guardrail: only TW-generated transactions can invoke indexer/update-from-txHash
  if (!isTWGenerated) {
    return {
      success: false,
      stage: 'pending_confirmation',
      txHash,
      escrowId,
      action,
      network,
      submissionPath: 'external',
      error:
        'Guardrail: indexer/update-from-txHash only permitted for TW-generated XDRs',
    }
  }

  // 3. Immediately persist txHash + network (status = pending_confirmation)
  const retryRecord = await upsertRetryRecord({
    txHash,
    escrowId,
    action,
    network,
    submissionPath: 'external',
    status: 'retrying',
    attemptCount: 1,
  })

  // 4. Verify directly against the Stellar network
  const ledgerRes = await verifyStellarTransaction(txHash, network)
  if (!ledgerRes.verified) {
    const errorMsg = ledgerRes.error ?? 'Ledger verification failed'
    // If the failure is terminal (e.g. failed on-ledger or format error), mark dead letter
    if (ledgerRes.successful === false) {
      await updateRetryRecordStatus(retryRecord.id, 'dead_letter', 1, errorMsg)
    } else {
      await updateRetryRecordStatus(retryRecord.id, 'retrying', 1, errorMsg)
    }

    return {
      success: false,
      stage: 'pending_confirmation',
      txHash,
      escrowId,
      action,
      network,
      submissionPath: 'external',
      retryRecordId: retryRecord.id,
      error: errorMsg,
    }
  }

  // 5. Invoke Trustless Work indexer/update-from-txHash
  const twRes = await updateTWIndexerFromTxHash(txHash, network, isTWGenerated)
  if (!twRes.success) {
    const errorMsg = twRes.error ?? 'TW indexer synchronization failed'
    await updateRetryRecordStatus(retryRecord.id, 'retrying', 1, errorMsg)
    return {
      success: false,
      stage: 'ledger_confirmed',
      txHash,
      escrowId,
      action,
      network,
      submissionPath: 'external',
      retryRecordId: retryRecord.id,
      ledger: ledgerRes.ledger,
      error: errorMsg,
    }
  }

  // 6. Both ledger_confirmed and tw_indexed succeeded -> promote SafeTrust DB record
  await promoteEscrowStatus(escrowId, action, txHash, network)
  await updateRetryRecordStatus(retryRecord.id, 'completed', 1, null)

  return {
    success: true,
    stage: 'confirmed',
    txHash,
    escrowId,
    action,
    network,
    submissionPath: 'external',
    retryRecordId: retryRecord.id,
    ledger: ledgerRes.ledger,
    twIndexed: true,
  }
}

// ── Background Durable Retry Worker ───────────────────────────────────────────

/**
 * Sweeps pending confirmation retries from the database, executing with
 * exponential backoff, dead-lettering after MAX_ATTEMPTS, and maintaining idempotency.
 */
export async function processPendingConfirmationRetries(): Promise<ProcessRetriesSummary> {
  const summary: ProcessRetriesSummary = {
    processed: 0,
    succeeded: 0,
    retried: 0,
    deadLettered: 0,
    errors: [],
  }

  // Fetch retries ready to execute
  const { rows } = await db.query<any>(
    `
    SELECT
      id,
      tx_hash AS "txHash",
      escrow_id AS "escrowId",
      escrow_action AS "escrowAction",
      network,
      submission_path AS "submissionPath",
      status,
      attempt_count AS "attemptCount",
      max_attempts AS "maxAttempts",
      last_error AS "lastError"
    FROM safetrust.escrow_confirmation_retries
    WHERE status = 'retrying'
      AND next_retry_at <= NOW()
    ORDER BY next_retry_at ASC
    LIMIT 50
    `
  )

  if (rows.length === 0) {
    return summary
  }

  summary.processed = rows.length

  for (const record of rows) {
    const nextAttempt = record.attemptCount + 1

    if (nextAttempt > record.maxAttempts) {
      await updateRetryRecordStatus(
        record.id,
        'dead_letter',
        record.attemptCount,
        'Exceeded maximum confirmation retry attempts'
      )
      summary.deadLettered++
      continue
    }

    try {
      // 1. Verify ledger
      const ledgerRes = await verifyStellarTransaction(
        record.txHash,
        record.network
      )
      if (!ledgerRes.verified) {
        if (ledgerRes.successful === false || nextAttempt >= record.maxAttempts) {
          await updateRetryRecordStatus(
            record.id,
            'dead_letter',
            nextAttempt,
            ledgerRes.error ?? 'Transaction failed on-ledger'
          )
          summary.deadLettered++
        } else {
          await updateRetryRecordStatus(
            record.id,
            'retrying',
            nextAttempt,
            ledgerRes.error ?? 'Ledger confirmation pending'
          )
          summary.retried++
        }
        continue
      }

      // 2. If external submission, sync TW indexer
      if (record.submissionPath === 'external') {
        const twRes = await updateTWIndexerFromTxHash(
          record.txHash,
          record.network,
          true
        )
        if (!twRes.success) {
          if (nextAttempt >= record.maxAttempts) {
            await updateRetryRecordStatus(
              record.id,
              'dead_letter',
              nextAttempt,
              twRes.error ?? 'TW indexer failed'
            )
            summary.deadLettered++
          } else {
            await updateRetryRecordStatus(
              record.id,
              'retrying',
              nextAttempt,
              twRes.error ?? 'TW indexer synchronization failed'
            )
            summary.retried++
          }
          continue
        }
      }

      // 3. Both succeeded -> promote status to confirmed and mark completed
      await promoteEscrowStatus(
        record.escrowId,
        record.escrowAction,
        record.txHash,
        record.network
      )
      await updateRetryRecordStatus(record.id, 'completed', nextAttempt, null)
      summary.succeeded++
    } catch (workerErr) {
      const errMessage = (workerErr as Error).message
      summary.errors.push(`Retry id ${record.id}: ${errMessage}`)
      if (nextAttempt >= record.maxAttempts) {
        await updateRetryRecordStatus(
          record.id,
          'dead_letter',
          nextAttempt,
          errMessage
        )
        summary.deadLettered++
      } else {
        await updateRetryRecordStatus(
          record.id,
          'retrying',
          nextAttempt,
          errMessage
        )
        summary.retried++
      }
    }
  }

  return summary
}
