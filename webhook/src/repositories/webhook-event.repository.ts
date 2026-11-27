import { createHash } from 'crypto'
import { PoolClient } from 'pg'
import { pool } from '../services/db'
import { getPlatformTenantId } from '../config/tenant'
import { logger } from '../middleware/logger'

export interface WebhookEventResult {
  isDuplicate: boolean
  eventId: string
  /**
   * Set for duplicates only: whether the earlier delivery finished. A duplicate
   * with `processed: false` failed part-way and should be retried.
   */
  processed?: boolean
}

export interface ProcessedWebhookEventResult<T> extends WebhookEventResult {
  result: T | null
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`
  }

  return JSON.stringify(value) ?? 'null'
}

export function getWebhookEventIdentity(
  contractId: string,
  eventType: string,
  payload: unknown,
  tenantId: string = getPlatformTenantId()
): string {
  // Existing Trustless Work payload types and the event table expose no single
  // provider ID; use recognized IDs when present, otherwise hash the full event.
  const payloadRecord =
    payload !== null && typeof payload === 'object'
      ? payload as Record<string, unknown>
      : {}
  const providerEventId = [
    payloadRecord.providerEventId,
    payloadRecord.eventId,
    payloadRecord.event_id,
  ].find((value): value is string => typeof value === 'string' && value.length > 0)
  const transactionIdentity = [
    payloadRecord.transactionHash,
    payloadRecord.transaction_hash,
    payloadRecord.txHash,
  ].find((value): value is string => typeof value === 'string' && value.length > 0)

  const sourceIdentity = providerEventId
    ? `provider:${providerEventId}`
    : transactionIdentity
      ? `transaction:${transactionIdentity}:${canonicalize(payload)}`
      : `payload:${canonicalize(payload)}`

  return createHash('sha256')
    .update(canonicalize([tenantId, contractId, eventType, sourceIdentity]))
    .digest('hex')
}

/**
 * Atomically claim a logical webhook event using its unique identity.
 */
export async function logAndCheckWebhookEvent(
  contractId: string,
  eventType: string,
  payload: unknown,
  tenantId: string = getPlatformTenantId()
): Promise<WebhookEventResult> {
  const client = await pool.connect()
  const eventIdentity = getWebhookEventIdentity(contractId, eventType, payload, tenantId)

  try {
    await client.query('BEGIN')

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO safetrust.trustless_work_webhook_events (
         contract_id,
         event_type,
         event_identity,
         payload,
         processed,
         tenant_id
       ) VALUES ($1, $2, $3, $4, false, $5)
       ON CONFLICT (tenant_id, event_identity) DO NOTHING
       RETURNING id`,
      [contractId, eventType, eventIdentity, JSON.stringify(payload), tenantId]
    )

    let eventId = inserted.rows[0]?.id
    const isDuplicate = !eventId
    let processed: boolean | undefined

    if (isDuplicate) {
      const existing = await client.query<{ id: string; processed: boolean }>(
        `SELECT id, processed
         FROM safetrust.trustless_work_webhook_events
         WHERE tenant_id = $1 AND event_identity = $2`,
        [tenantId, eventIdentity]
      )
      eventId = existing.rows[0]?.id
      if (!eventId) {
        throw new Error('Conflicting webhook event identity was not found')
      }
      processed = existing.rows[0].processed
    }

    await client.query('COMMIT')

    return isDuplicate
      ? { isDuplicate, eventId, processed }
      : { isDuplicate, eventId }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Claim an event, run its database state transition, and mark it processed in
 * one PostgreSQL transaction. A failed callback rolls back the claim as well.
 */
export async function processWebhookEvent<T>(
  contractId: string,
  eventType: string,
  payload: unknown,
  process: (client: PoolClient) => Promise<T | null>,
  tenantId: string = getPlatformTenantId()
): Promise<ProcessedWebhookEventResult<T>> {
  const client = await pool.connect()
  const eventIdentity = getWebhookEventIdentity(contractId, eventType, payload, tenantId)

  try {
    await client.query('BEGIN')

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO safetrust.trustless_work_webhook_events (
         contract_id, event_type, event_identity, payload, processed, tenant_id
       ) VALUES ($1, $2, $3, $4, false, $5)
       ON CONFLICT (tenant_id, event_identity) DO NOTHING
       RETURNING id`,
      [contractId, eventType, eventIdentity, JSON.stringify(payload), tenantId]
    )

    const claimedEventId = inserted.rows[0]?.id
    if (!claimedEventId) {
      const existing = await client.query<{ id: string }>(
        `SELECT id
         FROM safetrust.trustless_work_webhook_events
         WHERE tenant_id = $1 AND event_identity = $2`,
        [tenantId, eventIdentity]
      )
      const eventId = existing.rows[0]?.id
      if (!eventId) {
        throw new Error('Conflicting webhook event identity was not found')
      }
      await client.query('COMMIT')
      return { isDuplicate: true, eventId, result: null }
    }

    const result = await process(client)
    if (result === null) {
      await client.query('ROLLBACK')
      return { isDuplicate: false, eventId: claimedEventId, result: null }
    }

    await client.query(
      `UPDATE safetrust.trustless_work_webhook_events
       SET processed = true, processed_at = NOW()
       WHERE id = $1
         AND tenant_id = $2`,
      [claimedEventId, tenantId]
    )
    await client.query('COMMIT')

    return { isDuplicate: false, eventId: claimedEventId, result }
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      logger.error('webhook_event.rollback_failed', { error: rollbackError })
    }
    throw error
  } finally {
    client.release()
  }
}

/**
 * Mark a webhook event as processed.
 */
export async function markWebhookEventProcessed(
  eventId: string,
  tenantId: string = getPlatformTenantId()
): Promise<void> {
  await pool.query(
    `UPDATE safetrust.trustless_work_webhook_events
     SET processed    = true,
         processed_at = $2
     WHERE id = $1
       AND tenant_id = $3`,
    [eventId, new Date(), tenantId]
  )
}
