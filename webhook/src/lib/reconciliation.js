'use strict';

/**
 * @file src/lib/reconciliation.js
 * @description Core helpers for the reconciliation service.
 *
 * Responsibilities
 * ────────────────
 *  • chunkArray  — split a flat array into sub-arrays of `size`
 *  • fetchEscrowsByContractIds — call TrustlessWork indexer API
 *  • syncChunk   — upsert one batch of escrows into the DB
 *
 * All functions are exported individually so they can be unit-tested
 * without requiring a live database or external API.
 */

const https = require('https');
const http = require('http');
const db = require('../services/db');

/** Maximum contract IDs the TrustlessWork indexer accepts per request. */
const CHUNK_SIZE = 50;

// ─── TrustlessWork API base URL (injected from env) ──────────────────────────
const TW_BASE_URL =
  process.env.TRUSTLESS_WORK_API_URL || 'https://dev.api.trustlesswork.com';
const TW_API_KEY = process.env.TRUSTLESS_WORK_API_KEY || '';

// ─── Idempotent UPSERT ────────────────────────────────────────────────────────
/**
 * INSERT … ON CONFLICT (contract_id) DO UPDATE …
 * The WHERE clause uses IS DISTINCT FROM so unchanged rows produce 0 affected
 * rows — xmax = 0 means the row was inserted; otherwise it was updated.
 *
 * Columns synced from the indexer:
 *   status, amount, balance, marker, approver, releaser, updated_at
 *
 * Columns NOT touched (owned by SafeTrust):
 *   id, booking_id, room_id, hotel_id, guest_id, booking_*, escrow_metadata,
 *   booking_metadata, created_at, tenant_id, escrow_type, asset_code,
 *   asset_issuer, resolver
 */
const UPSERT_ESCROW_SQL = `
  INSERT INTO public.trustless_work_escrows (
    contract_id,
    status,
    amount,
    balance,
    marker,
    approver,
    releaser,
    escrow_type,
    updated_at,
    tenant_id
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'safetrust')
  ON CONFLICT (contract_id)
  DO UPDATE SET
    status     = EXCLUDED.status,
    amount     = EXCLUDED.amount,
    balance    = EXCLUDED.balance,
    marker     = EXCLUDED.marker,
    approver   = EXCLUDED.approver,
    releaser   = EXCLUDED.releaser,
    updated_at = NOW()
  WHERE (
    public.trustless_work_escrows.status,
    public.trustless_work_escrows.amount,
    public.trustless_work_escrows.balance,
    public.trustless_work_escrows.marker,
    public.trustless_work_escrows.approver,
    public.trustless_work_escrows.releaser
  ) IS DISTINCT FROM (
    EXCLUDED.status,
    EXCLUDED.amount,
    EXCLUDED.balance,
    EXCLUDED.marker,
    EXCLUDED.approver,
    EXCLUDED.releaser
  )
  RETURNING contract_id, (xmax = 0) AS inserted
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Split `arr` into consecutive sub-arrays of at most `size` elements.
 *
 * @param {any[]} arr   Source array.
 * @param {number} size Maximum chunk length (must be > 0).
 * @returns {any[][]}   Array of chunks.
 */
function chunkArray(arr, size) {
  if (!Array.isArray(arr)) throw new TypeError('chunkArray: arr must be an array');
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('chunkArray: size must be a positive integer');
  }

  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Lightweight HTTP/HTTPS GET helper — uses Node's built-in modules so that
 * no extra runtime dependency is required.
 *
 * @param {string} url  Absolute URL (http or https).
 * @param {object} [headers] Additional request headers.
 * @returns {Promise<object>} Parsed JSON response body.
 */
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(TW_API_KEY ? { 'x-api-key': TW_API_KEY } : {}),
        ...headers,
      },
    };

    const req = transport.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(
            new Error(
              `TrustlessWork API responded with status ${res.statusCode}: ${raw}`
            )
          );
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error(`Failed to parse TrustlessWork API response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error('TrustlessWork API request timed out after 30 s'));
    });
    req.end();
  });
}

/**
 * Fetch escrow data from the TrustlessWork indexer for a batch of contract IDs.
 *
 * Endpoint: GET /helper/get-escrows-by-contract-ids?contractIds=id1,id2,...
 *
 * @param {string[]} contractIds  Array of contract IDs (max CHUNK_SIZE).
 * @returns {Promise<object[]>}   Array of escrow objects from the indexer.
 */
async function fetchEscrowsByContractIds(contractIds) {
  const qs = encodeURIComponent(contractIds.join(','));
  const url = `${TW_BASE_URL}/helper/get-escrows-by-contract-ids?contractIds=${qs}`;

  const data = await httpGet(url);

  // The API may return { escrows: [...] } or a bare array — handle both.
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.escrows)) return data.escrows;

  throw new Error(
    `Unexpected TrustlessWork API response shape: ${JSON.stringify(data).slice(0, 200)}`
  );
}

/**
 * Upsert a single chunk of contract IDs into public.trustless_work_escrows.
 *
 * Escrows whose indexed fields have not changed are skipped (IS DISTINCT FROM).
 * Each escrow in the chunk is processed independently so one bad record does
 * not abort the entire batch.
 *
 * @param {string[]} contractIds  Up to CHUNK_SIZE contract IDs.
 * @returns {Promise<{updated: number, unchanged: number, skipped: number}>}
 */
async function syncChunk(contractIds) {
  const escrows = await fetchEscrowsByContractIds(contractIds);

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const escrow of escrows) {
    // Guard: contract_id is mandatory — skip malformed records.
    if (!escrow?.contractId) {
      console.warn('[reconciliation] ⚠️  Skipping escrow without contractId:', escrow);
      skipped++;
      continue;
    }

    try {
      const result = await db.query(UPSERT_ESCROW_SQL, [
        escrow.contractId,                   // $1 contract_id
        escrow.status ?? 'created',          // $2 status
        escrow.amount ?? 0,                  // $3 amount
        escrow.balance ?? 0,                 // $4 balance
        escrow.roles?.marker ?? '',          // $5 marker
        escrow.roles?.approver ?? '',        // $6 approver
        escrow.roles?.releaser ?? '',        // $7 releaser
        escrow.escrowType ?? 'single_release', // $8 escrow_type
      ]);

      // RETURNING only fires when a row was actually changed.
      if (result.rows.length > 0) {
        updated++;
      } else {
        unchanged++;
      }
    } catch (rowError) {
      // Isolate per-row errors — log and count as skipped.
      console.error(
        `[reconciliation] ⚠️  Row error for contract_id "${escrow.contractId}":`,
        rowError.message
      );
      skipped++;
    }
  }

  return { updated, unchanged, skipped };
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  CHUNK_SIZE,
  chunkArray,
  fetchEscrowsByContractIds,
  syncChunk,
};
