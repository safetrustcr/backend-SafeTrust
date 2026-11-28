'use strict'

/**
 * @file src/services/retention.service.ts
 * @description Data retention for operational tables.
 *
 * Invoked on a schedule by the Hasura cron trigger -> POST
 * /reconciliation/prune-retention. The actual cleanup runs in the database
 * function safetrust.prune_operational_data(retry_days, payload_days) so the
 * server owns the transaction, and the periods come from configuration
 * (RETENTION_RETRY_DAYS, RETENTION_PAYLOAD_DAYS).
 */

import { query } from './db'
import { logger } from '../middleware/logger'

const DEFAULT_RETRY_DAYS = 30
const DEFAULT_PAYLOAD_DAYS = 90

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

export interface RetentionResult {
  retryDays: number
  payloadDays: number
  deletedRetries: number
  scrubbedPayloads: number
}

/**
 * Deletes finished escrow_confirmation_retries rows and nulls out the payload
 * of old trustless_work_webhook_events rows (keeping event_identity and the
 * columns analytics reads).
 */
export async function pruneOperationalData(
  retryDays = positiveIntegerFromEnv('RETENTION_RETRY_DAYS', DEFAULT_RETRY_DAYS),
  payloadDays = positiveIntegerFromEnv('RETENTION_PAYLOAD_DAYS', DEFAULT_PAYLOAD_DAYS)
): Promise<RetentionResult> {
  const result = await query<{ deleted_retries: string; scrubbed_payloads: string }>(
    'SELECT deleted_retries, scrubbed_payloads FROM safetrust.prune_operational_data($1, $2)',
    [retryDays, payloadDays]
  )

  const row = result.rows[0]
  const deletedRetries = Number(row?.deleted_retries ?? 0)
  const scrubbedPayloads = Number(row?.scrubbed_payloads ?? 0)

  logger.info('retention.prune.completed', {
    retryDays,
    payloadDays,
    deletedRetries,
    scrubbedPayloads,
  })

  return { retryDays, payloadDays, deletedRetries, scrubbedPayloads }
}
