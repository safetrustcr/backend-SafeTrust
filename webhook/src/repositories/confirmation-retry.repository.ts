'use strict'

import dbService, { pool, query as dbQuery, type Queryable } from '../services/db'
import type {
  ConfirmationRetryRecord,
  EscrowAction,
  RetryStatus,
  StellarNetwork,
  SubmissionPath,
} from '../services/confirmation.service'
import {
  calculateBackoffMs,
  MAX_ATTEMPTS,
} from '../services/confirmation.service'
import { getPlatformTenantId } from '../config/tenant'

const defaultDb: Queryable = {
  query: <T extends import('pg').QueryResultRow = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ) => {
    if (dbService && typeof dbService.query === 'function') {
      return dbService.query<T>(text, params)
    }
    if (pool && typeof pool.query === 'function') {
      return pool.query<T>(text, params)
    }
    return dbQuery<T>(text, params)
  },
}

export interface UpsertRetryRecordParams {
  txHash: string
  escrowId: string
  action: EscrowAction
  network: StellarNetwork
  submissionPath: SubmissionPath
  tenantId?: string
  status?: RetryStatus
  lastError?: string | null
  attemptCount?: number
  metadata?: Record<string, unknown>
}

/**
 * Upserts a confirmation retry record into safetrust.escrow_confirmation_retries.
 */
export async function upsertRetryRecord(
  params: UpsertRetryRecordParams,
  db: Queryable = defaultDb
): Promise<ConfirmationRetryRecord> {
  const status = params.status ?? 'retrying'
  const attemptCount = params.attemptCount ?? 0
  const nextRetryMs = status === 'retrying' ? calculateBackoffMs(attemptCount) : 0
  const tenantId = params.tenantId ?? getPlatformTenantId()

  const { rows } = await db.query<ConfirmationRetryRecord>(
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
      $10, $11, $12, NOW()
    )
    ON CONFLICT (tenant_id, tx_hash, escrow_action)
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
      tenantId,
    ]
  )

  return rows[0]
}

/**
 * Updates status and backoff for a confirmation retry record.
 */
export async function updateRetryRecordStatus(
  id: string,
  status: RetryStatus,
  attemptCount: number,
  lastError: string | null,
  dbOrTenantId: Queryable | string = defaultDb,
  database?: Queryable
): Promise<void> {
  const nextRetryMs = status === 'retrying' ? calculateBackoffMs(attemptCount) : 0
  const db = typeof dbOrTenantId === 'string' ? database ?? defaultDb : dbOrTenantId
  const tenantId = typeof dbOrTenantId === 'string' ? dbOrTenantId : getPlatformTenantId()

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
      AND tenant_id = $6
    `,
    [status, attemptCount, lastError, nextRetryMs, id, tenantId]
  )
}

/**
 * Fetches pending confirmation retries that are due for execution.
 */
export async function fetchPendingRetries(
  limit = 50,
  dbOrTenantId: Queryable | string = defaultDb,
  database?: Queryable
): Promise<ConfirmationRetryRecord[]> {
  const db = typeof dbOrTenantId === 'string' ? database ?? defaultDb : dbOrTenantId
  const tenantId = typeof dbOrTenantId === 'string' ? dbOrTenantId : getPlatformTenantId()
  const { rows } = await db.query<ConfirmationRetryRecord>(
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
      AND tenant_id = $2
    ORDER BY next_retry_at ASC
    LIMIT $1
    `,
    [limit, tenantId]
  )

  return rows
}
