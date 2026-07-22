'use strict';

const { pool } = require('./db');

const DEFAULT_HASURA_ENDPOINT = 'http://graphql-engine:8080/v1/graphql';
const DEFAULT_HASURA_TIMEOUT_MS = 10000;
const TENANT_ID = 'safetrust';

function getHasuraEndpoint() {
  const configured = process.env.HASURA_GRAPHQL_ENDPOINT || DEFAULT_HASURA_ENDPOINT;
  return configured.endsWith('/v1/graphql')
    ? configured
    : `${configured.replace(/\/$/, '')}/v1/graphql`;
}

/**
 * Execute a Hasura GraphQL query or mutation.
 * @param {string} query
 * @param {object} [variables]
 * @param {number} [timeoutMs]
 * @returns {Promise<object>}
 */
async function hasuraRequest(query, variables = {}, timeoutMs = DEFAULT_HASURA_TIMEOUT_MS) {
  const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET;

  if (!adminSecret) {
    throw new Error('Missing HASURA_GRAPHQL_ADMIN_SECRET');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(getHasuraEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hasura-admin-secret': adminSecret,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Hasura request failed with status ${response.status}`);
    }

    if (data.errors) {
      const error = new Error('Hasura request failed');
      error.details = data.errors;
      throw error;
    }

    return data.data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Log an incoming webhook event and check if it was already processed.
 * Uses trustless_work_webhook_events for O(1) deduplication via hash index.
 *
 * Big O:
 *   Hash index lookup on (contract_id, event_type): O(1)
 *   INSERT of new event record: O(1)
 *   Total overhead per handler call: O(1)
 *
 * Lookup and insert run in one PostgreSQL transaction with an advisory lock so
 * concurrent deliveries for the same idempotency key cannot both proceed.
 *
 * @param {string} contractId
 * @param {string} eventType - e.g. 'escrow.funded', 'milestone.approved:check_in'
 * @param {object} payload - raw request body
 * @returns {Promise<{ isDuplicate: boolean, eventId: string }>}
 */
async function logAndCheckWebhookEvent(contractId, eventType, payload) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${TENANT_ID}:${contractId}:${eventType}`,
    ]);

    const existing = await client.query(
      `SELECT id
       FROM public.trustless_work_webhook_events
       WHERE contract_id = $1
         AND event_type = $2
         AND processed = true
         AND tenant_id = $3
       LIMIT 1`,
      [contractId, eventType, TENANT_ID]
    );

    const isDuplicate = existing.rows.length > 0;

    const inserted = await client.query(
      `INSERT INTO public.trustless_work_webhook_events (
         contract_id,
         event_type,
         payload,
         processed,
         tenant_id
       ) VALUES ($1, $2, $3, false, $4)
       RETURNING id`,
      [contractId, eventType, JSON.stringify(payload), TENANT_ID]
    );

    await client.query('COMMIT');

    return {
      isDuplicate,
      eventId: inserted.rows[0].id,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Mark a webhook event as processed.
 * @param {string} eventId
 */
async function markWebhookEventProcessed(eventId) {
  await pool.query(
    `UPDATE public.trustless_work_webhook_events
     SET processed = true, processed_at = $2
     WHERE id = $1`,
    [eventId, new Date()]
  );
}

module.exports = {
  getHasuraEndpoint,
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
};
