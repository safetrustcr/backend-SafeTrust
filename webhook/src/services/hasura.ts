'use strict'

import { pool } from './db'

const DEFAULT_HASURA_ENDPOINT  = 'http://graphql-engine:8080/v1/graphql'
const DEFAULT_HASURA_TIMEOUT_MS = 10_000
const TENANT_ID                = 'safetrust'

// ── Types ──────────────────────────────────────────────────────────────────────

interface HasuraError {
  message: string
  extensions?: Record<string, unknown>
}

interface HasuraResponse<T> {
  data: T
  errors?: HasuraError[]
}

export interface WebhookEventResult {
  isDuplicate: boolean
  eventId: string
}

// Extend Error to carry Hasura error details
interface HasuraRequestError extends Error {
  details: HasuraError[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function getHasuraEndpoint(): string {
  const configured = process.env.HASURA_GRAPHQL_ENDPOINT ?? DEFAULT_HASURA_ENDPOINT
  return configured.endsWith('/v1/graphql')
    ? configured
    : `${configured.replace(/\/$/, '')}/v1/graphql`
}

// ── Core request ───────────────────────────────────────────────────────────────

/**
 * Execute a Hasura GraphQL query or mutation.
 * Throws a typed error with `details` when Hasura returns errors.
 */
export async function hasuraRequest<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_HASURA_TIMEOUT_MS
): Promise<T> {
  const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET

  if (!adminSecret) {
    throw new Error('Missing HASURA_GRAPHQL_ADMIN_SECRET')
  }

  const response = await fetch(getHasuraEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type':        'application/json',
      'x-hasura-admin-secret': adminSecret,
    },
    body:   JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  const json = (await response.json()) as HasuraResponse<T>

  if (!response.ok) {
    throw new Error(`Hasura request failed with status ${response.status}`)
  }

  if (json.errors?.length) {
    const error = new Error('Hasura request failed') as HasuraRequestError
    error.details = json.errors
    throw error
  }

  return json.data
}

// ── Webhook event deduplication ────────────────────────────────────────────────

/**
 * Log an incoming webhook event and check if it was already processed.
 * Uses trustless_work_webhook_events for O(1) deduplication via hash index.
 *
 * Big O:
 *   Hash index lookup on (contract_id, event_type): O(1)
 *   INSERT of new event record: O(1)
 *   Total overhead per handler call: O(1)
 *
 * Lookup and insert run in one PostgreSQL transaction with an advisory lock
 * so concurrent deliveries for the same idempotency key cannot both proceed.
 */
export async function logAndCheckWebhookEvent(
  contractId: string,
  eventType: string,
  payload: Record<string, unknown>
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
       FROM safetrust.trustless_work_webhook_events
       WHERE contract_id = $1
         AND event_type  = $2
         AND processed   = true
         AND tenant_id   = $3
       LIMIT 1`,
      [contractId, eventType, TENANT_ID]
    )

    const isDuplicate = existing.rows.length > 0

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO safetrust.trustless_work_webhook_events (
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
    `UPDATE safetrust.trustless_work_webhook_events
     SET processed    = true,
         processed_at = $2
     WHERE id = $1`,
    [eventId, new Date()]
  )
}

export default {
  getHasuraEndpoint,
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
}