import { pool } from '../services/db'

const TENANT_ID = 'safetrust'

export interface WebhookEventResult {
  isDuplicate: boolean
  eventId: string
}

/**
 * Log an incoming webhook event and check if it was already processed.
 * Uses trustless_work_webhook_events for O(1) deduplication via hash index.
 */
export async function logAndCheckWebhookEvent(
  contractId: string,
  eventType: string,
  payload: unknown
): Promise<WebhookEventResult> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Advisory lock prevents concurrent duplicate processing
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${TENANT_ID}:${contractId}:${eventType}`,
    ])

    const existing = await client.query<{ id: string }>(
      `SELECT id
       FROM public.trustless_work_webhook_events
       WHERE contract_id = $1
         AND event_type  = $2
         AND processed   = true
         AND tenant_id   = $3
       LIMIT 1`,
      [contractId, eventType, TENANT_ID]
    )

    const isDuplicate = existing.rows.length > 0

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO public.trustless_work_webhook_events (
         contract_id,
         event_type,
         payload,
         processed,
         tenant_id
       ) VALUES ($1, $2, $3, false, $4)
       RETURNING id`,
      [contractId, eventType, JSON.stringify(payload), TENANT_ID]
    )

    await client.query('COMMIT')

    return {
      isDuplicate,
      eventId: inserted.rows[0].id,
    }
  } catch (error) {
    await client.query('ROLLBACK')
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
    `UPDATE public.trustless_work_webhook_events
     SET processed    = true,
         processed_at = $2
     WHERE id = $1`,
    [eventId, new Date()]
  )
}
