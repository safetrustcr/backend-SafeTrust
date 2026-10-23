import { createHash } from 'crypto'
import { PoolClient } from 'pg'
import { pool } from '../services/db'

const TENANT_ID = 'safetrust'

export interface WebhookEventResult {
  isDuplicate: boolean
  eventId: string
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

function getEventIdentity(
  contractId: string,
  eventType: string,
  payload: unknown
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
    .update(canonicalize([TENANT_ID, contractId, eventType, sourceIdentity]))
    .digest('hex')
}

/**
 * Atomically claim a logical webhook event using its unique identity.
 */
export async function logAndCheckWebhookEvent(
  contractId: string,
  eventType: string,
  payload: unknown
): Promise<WebhookEventResult> {
  const client = await pool.connect()
  const eventIdentity = getEventIdentity(contractId, eventType, payload)

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
      [contractId, eventType, eventIdentity, JSON.stringify(payload), TENANT_ID]
    )

    let eventId = inserted.rows[0]?.id
    const isDuplicate = !eventId

    if (isDuplicate) {
      const existing = await client.query<{ id: string }>(
        `SELECT id
         FROM safetrust.trustless_work_webhook_events
         WHERE tenant_id = $1 AND event_identity = $2`,
        [TENANT_ID, eventIdentity]
      )
      eventId = existing.rows[0]?.id
      if (!eventId) {
        throw new Error('Conflicting webhook event identity was not found')
      }
    }

    await client.query('COMMIT')

    return {
      isDuplicate,
      eventId,
    }
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
  process: (client: PoolClient) => Promise<T | null>
): Promise<ProcessedWebhookEventResult<T>> {
  const client = await pool.connect()
  const eventIdentity = getEventIdentity(contractId, eventType, payload)

  try {
    await client.query('BEGIN')

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO safetrust.trustless_work_webhook_events (
         contract_id, event_type, event_identity, payload, processed, tenant_id
       ) VALUES ($1, $2, $3, $4, false, $5)
       ON CONFLICT (tenant_id, event_identity) DO NOTHING
       RETURNING id`,
      [contractId, eventType, eventIdentity, JSON.stringify(payload), TENANT_ID]
    )

    const claimedEventId = inserted.rows[0]?.id
    if (!claimedEventId) {
      const existing = await client.query<{ id: string }>(
        `SELECT id
         FROM safetrust.trustless_work_webhook_events
         WHERE tenant_id = $1 AND event_identity = $2`,
        [TENANT_ID, eventIdentity]
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
       WHERE id = $1`,
      [claimedEventId]
    )
    await client.query('COMMIT')

    return { isDuplicate: false, eventId: claimedEventId, result }
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      console.error('[webhook-event.repository] Failed to rollback event transaction:', rollbackError)
    }
    throw error
  } finally {
    client.release()
  }
}

/**
 * Mark a webhook event as processed.
 */
export async function markWebhookEventProcessed(eventId: string): Promise<void> {
  await pool.query(
    `UPDATE safetrust.trustless_work_webhook_events
     SET processed    = true,
         processed_at = $2
     WHERE id = $1`,
    [eventId, new Date()]
  )
}
