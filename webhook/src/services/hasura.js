'use strict';

const DEFAULT_HASURA_ENDPOINT = 'http://graphql-engine:8080/v1/graphql';

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
 * @returns {Promise<object>}
 */
async function hasuraRequest(query, variables = {}) {
  const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET;

  if (!adminSecret) {
    throw new Error('Missing HASURA_GRAPHQL_ADMIN_SECRET');
  }

  const response = await fetch(getHasuraEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': adminSecret,
    },
    body: JSON.stringify({ query, variables }),
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
 * @param {string} contractId
 * @param {string} eventType - e.g. 'escrow.funded', 'milestone.approved'
 * @param {object} payload - raw request body
 * @returns {Promise<{ isDuplicate: boolean, eventId: string }>}
 */
async function logAndCheckWebhookEvent(contractId, eventType, payload) {
  const existing = await hasuraRequest(
    `query CheckProcessed($contractId: String!, $eventType: String!) {
      trustless_work_webhook_events(
        where: {
          contract_id: { _eq: $contractId }
          event_type: { _eq: $eventType }
          processed: { _eq: true }
          tenant_id: { _eq: "safetrust" }
        }
        limit: 1
      ) {
        id
      }
    }`,
    { contractId, eventType }
  );

  const isDuplicate = existing.trustless_work_webhook_events.length > 0;

  const inserted = await hasuraRequest(
    `mutation LogWebhookEvent(
      $contractId: String
      $eventType: String!
      $payload: jsonb!
    ) {
      insert_trustless_work_webhook_events_one(
        object: {
          contract_id: $contractId
          event_type: $eventType
          payload: $payload
          processed: false
          tenant_id: "safetrust"
        }
      ) {
        id
      }
    }`,
    { contractId, eventType, payload }
  );

  return {
    isDuplicate,
    eventId: inserted.insert_trustless_work_webhook_events_one.id,
  };
}

/**
 * Mark a webhook event as processed.
 * @param {string} eventId
 */
async function markWebhookEventProcessed(eventId) {
  await hasuraRequest(
    `mutation MarkProcessed($eventId: uuid!) {
      update_trustless_work_webhook_events_by_pk(
        pk_columns: { id: $eventId }
        _set: { processed: true, processed_at: "now()" }
      ) {
        id
      }
    }`,
    { eventId }
  );
}

module.exports = {
  getHasuraEndpoint,
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
};
