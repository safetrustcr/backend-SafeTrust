'use strict'

/**
 * @file src/lib/reconciliation.ts
 * @description Core helpers for the reconciliation service with freshness checks (Issue #661).
 *
 * Ordering & State Invariants Architecture:
 * ──────────────────────────────────────────
 * 1. Why `received_at` is NOT a valid ordering proxy:
 *    `received_at` reflects local HTTP receipt time, which is vulnerable to network latency,
 *    retries, and clock drift. A delayed snapshot can arrive after a newer confirmed event.
 *    The ledger sequence number (`ledger_seq`) from the source is the only authoritative
 *    ordering token.
 *
 * 2. The Unversioned Snapshot Policy:
 *    When no `ledger_seq` is provided by the source, snapshots may ONLY update unconfirmed
 *    pending records (`created`, `pending_funding`). Unversioned snapshots are rejected for
 *    any confirmed records (`funded`, `completed`, `resolved`, etc.), and nonzero stored
 *    balances must never be zeroed out.
 *
 * 3. The Four Conflict Cases & Outcomes:
 *    - Incoming newer (incoming_seq > stored_seq or stored is NULL): write update.
 *    - Incoming older (incoming_seq < stored_seq): reject silently, no write, no error.
 *    - Equal seq (incoming_seq == stored_seq), same values: idempotent no-op, no write.
 *    - Equal seq (incoming_seq == stored_seq), different values: preserve stored confirmed state,
 *      produce a conflict log entry.
 *
 * 4. Why Terminal States Must NOT Be Ordered by Numeric Status Rank:
 *    Escrow lifecycles are directed graphs, not linear ranks. Terminal states (`completed`,
 *    `resolved`, `cancelled`) represent final settlement. No subsequent observation, regardless
 *    of sequence number or rank, can overwrite or transition away from a terminal state.
 *
 * Responsibilities:
 *  • chunkArray  — split a flat array into sub-arrays of `size`
 *  • fetchEscrowsByContractIds — call TrustlessWork indexer API
 *  • syncChunk   — upsert one batch of escrows into the DB with freshness check
 *  • findStaleEscrows — O(log n + k) stale escrow detection via updated_at index
 */

import https from 'https'
import http from 'http'
import type { PoolClient } from 'pg'
import db, { connect } from '../services/db'
import {
  evaluateFreshness,
  formatExactBalance,
  balancesEqual,
  parseLedgerSeq,
  FreshnessOutcome,
  StoredEscrowState,
  IncomingEscrowObservation,
  CANONICAL_TRANSITIONS,
} from './escrow-freshness'

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface EscrowRoles {
  marker?:   string
  approver?: string
  releaser?: string
}

export interface EscrowRecord {
  contractId:  string
  status?:     string
  amount?:     string | number
  balance?:    string | number
  escrowType?: string
  roles?:      EscrowRoles
  ledgerSeq?:  number | string | bigint | null
  ledger_seq?: number | string | bigint | null
  network?:    string | null
}

export interface UpsertResult {
  updated:   number
  unchanged: number
  skipped:   number
}

export interface ChunkSyncResult extends UpsertResult {
  errors: string[]
}

export interface SyncAllResult extends ChunkSyncResult {
  chunks: number
}

export interface BulkUpsertAddon {
  bulkUpsertEscrows: (updatesJson: string, connString: string) => Promise<string>
}

export interface ChunkProcessorAddon {
  processChunksParallel: (
    chunksJson:    string,
    apiUrl:        string,
    apiKey:        string,
    concurrency:   number,
    timeoutMs:     number
  ) => Promise<string>
}

export interface BulkUpsertResult {
  rows_affected: number
  unchanged:     number
  duration_ms:   number
}

export interface ChunkResult {
  chunk_index: number
  fetched:     number
  duration_ms: number
  error:       string | null
  escrows:     EscrowRecord[]
}

interface BulkUpsertRow {
  contract_id: string
  status:      string
  amount:      string
  balance:     string
  marker:      string
  approver:    string
  releaser:    string
  escrow_type: string
  ledger_seq?: number | string | null
  network?:    string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum contract IDs the TrustlessWork indexer accepts per request. */
export const CHUNK_SIZE = 50

// ─── TrustlessWork API base URL (injected from env) ──────────────────────────
const TW_BASE_URL =
  process.env.TRUSTLESS_WORK_API_URL || 'https://dev.api.trustlesswork.com'
const TW_API_KEY = process.env.TRUSTLESS_WORK_API_KEY || ''

// ─── Optional Rust parallel chunk processor ──────────────────────────────────
/**
 * When RUST_CHUNKS_ENABLED=true, chunk HTTP requests are executed concurrently
 * by the `chunk-processor` Neon addon (Tokio + reqwest) instead of the sequential
 * JS loop. The DB UPSERT stays in JavaScript — the addon only parallelises the
 * network-bound fetch and hands escrow objects back verbatim, so counts and the
 * response JSON are identical to the sequential path.
 *
 * Everything below is gated: with the flag unset (default) the addon is never
 * loaded and behaviour is byte-for-byte unchanged.
 */
const CHUNK_PROCESSOR_MODULE = '../../../crates/chunk-processor'

/** Parse an int env var, falling back to `fallback` on absent/invalid values. */
function envInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** True when the operator has opted into the Rust parallel path. */
export function isRustChunkProcessingEnabled(): boolean {
  return process.env.RUST_CHUNKS_ENABLED === 'true'
}

// Lazily require the native addon so the flag-off path never touches it and a
// missing/unbuilt binary can degrade gracefully to the sequential loop.
let _chunkProcessor: ChunkProcessorAddon | null = null
let _chunkProcessorLoadFailed = false
// Test seam: lets unit tests inject a fake addon (or simulate an unavailable one)
// without a native build. `undefined` means "no override" — prod code never
// touches it, so the real require path runs.
let _chunkProcessorOverride: ChunkProcessorAddon | null | undefined
function loadChunkProcessor(): ChunkProcessorAddon | null {
  // A set override (object OR null) short-circuits the real require. `null`
  // deliberately simulates an unavailable addon.
  if (_chunkProcessorOverride !== undefined) return _chunkProcessorOverride
  if (_chunkProcessor || _chunkProcessorLoadFailed) return _chunkProcessor
  try {
    _chunkProcessor = require(CHUNK_PROCESSOR_MODULE)
  } catch (err) {
    _chunkProcessorLoadFailed = true
    console.error(
      '[reconciliation] ⚠️  chunk-processor addon unavailable — ' +
        `falling back to sequential sync: ${(err as Error).message}`
    )
  }
  return _chunkProcessor
}

/**
 * @internal Test-only: force `loadChunkProcessor()` to return `mock` (pass `null`
 * to simulate an unavailable addon).
 */
export function __setChunkProcessorForTests(
  mock: ChunkProcessorAddon | null | undefined
): void {
  _chunkProcessorOverride = mock
  _chunkProcessor = null
  _chunkProcessorLoadFailed = false
}

/** @internal Test-only: drop the override and restore the real require path. */
export function __resetChunkProcessorForTests(): void {
  _chunkProcessorOverride = undefined
  _chunkProcessor = null
  _chunkProcessorLoadFailed = false
}

// ─── Optional Rust bulk upsert ───────────────────────────────────────────────
/**
 * When RUST_BULK_UPSERT_ENABLED=true, a chunk's escrow writes go through the
 * `pg-bulk-upsert` Neon addon, which folds up to 50 per-row UPSERT round trips
 * into a single INSERT ... ON CONFLICT ... UNNEST statement. The SQL mirrors
 * UPSERT_ESCROW_SQL below, so the updated/unchanged counts and the response are
 * identical to the row-by-row path. Composes with the parallel fetch above: the
 * chunk-processor fetches concurrently, then each chunk is bulk-written here.
 *
 * Everything here is gated: with the flag unset (default) the addon is never
 * loaded and the row-by-row loop runs exactly as before.
 */
const BULK_UPSERT_MODULE = '../../../crates/pg-bulk-upsert'

/** True when the operator has opted into the Rust bulk upsert path. */
export function isRustBulkUpsertEnabled(): boolean {
  return process.env.RUST_BULK_UPSERT_ENABLED === 'true'
}

/**
 * Build a libpq connection string from the same POSTGRES_* env vars the Node
 * pg pool uses (see services/db). Credentials (user + password) have no default:
 * if either is unset this throws, so the bulk path fails loudly and falls back to
 * row-by-row rather than silently connecting with a well-known default password.
 * User and password are URL-encoded so special characters cannot corrupt the
 * string.
 */
export function buildConnectionString(): string {
  const user = process.env.POSTGRES_USER
  const password = process.env.POSTGRES_PASSWORD
  if (!user || !password) {
    throw new Error(
      'pg-bulk-upsert requires POSTGRES_USER and POSTGRES_PASSWORD to be set'
    )
  }
  const enc = encodeURIComponent
  const host = process.env.POSTGRES_HOST ?? 'localhost'
  const port = process.env.POSTGRES_PORT ?? '5432'
  const database = process.env.POSTGRES_DB ?? 'postgres'
  return `postgresql://${enc(user)}:${enc(password)}@${host}:${port}/${database}`
}

// Lazily require the native addon so the flag-off path never touches it and a
// missing/unbuilt binary can degrade gracefully to the row-by-row loop.
let _bulkUpsert: BulkUpsertAddon | null = null
let _bulkUpsertLoadFailed = false
// Test seam: `undefined` means "no override"; a set value (object or null) is
// returned as-is, so a test can inject a fake addon or simulate an absent one.
let _bulkUpsertOverride: BulkUpsertAddon | null | undefined
function loadBulkUpsert(): BulkUpsertAddon | null {
  if (_bulkUpsertOverride !== undefined) return _bulkUpsertOverride
  if (_bulkUpsert || _bulkUpsertLoadFailed) return _bulkUpsert
  try {
    _bulkUpsert = require(BULK_UPSERT_MODULE)
  } catch (err) {
    _bulkUpsertLoadFailed = true
    console.error(
      '[reconciliation] ⚠️  pg-bulk-upsert addon unavailable — ' +
        `falling back to row-by-row upsert: ${(err as Error).message}`
    )
  }
  return _bulkUpsert
}

/** @internal Test-only: force loadBulkUpsert() to return `mock` (null = absent). */
export function __setBulkUpsertForTests(
  mock: BulkUpsertAddon | null | undefined
): void {
  _bulkUpsertOverride = mock
  _bulkUpsert = null
  _bulkUpsertLoadFailed = false
}

/** @internal Test-only: drop the override and restore the real require path. */
export function __resetBulkUpsertForTests(): void {
  _bulkUpsertOverride = undefined
  _bulkUpsert = null
  _bulkUpsertLoadFailed = false
}

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
const SQL_TRANSITION_RULES = Object.entries(CANONICAL_TRANSITIONS)
  .filter(([_, targets]) => targets.length > 0)
  .map(
    ([from, targets]) =>
      `(safetrust.trustless_work_escrows.status = '${from}' AND EXCLUDED.status IN (${targets.map(t => `'${t}'`).join(', ')}))`
  )
  .join(' OR\n        ')

const UPSERT_ESCROW_SQL = `
  INSERT INTO safetrust.trustless_work_escrows (
    contract_id,
    status,
    amount,
    balance,
    marker,
    approver,
    releaser,
    escrow_type,
    network,
    updated_at,
    tenant_id
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 'safetrust')
  ON CONFLICT (contract_id)
  DO UPDATE SET
    status     = EXCLUDED.status,
    amount     = EXCLUDED.amount,
    balance    = CASE
      WHEN safetrust.trustless_work_escrows.balance > 0 AND EXCLUDED.balance = 0
        THEN safetrust.trustless_work_escrows.balance
      ELSE EXCLUDED.balance
    END,
    marker     = COALESCE(NULLIF(EXCLUDED.marker, ''), safetrust.trustless_work_escrows.marker),
    approver   = COALESCE(NULLIF(EXCLUDED.approver, ''), safetrust.trustless_work_escrows.approver),
    releaser   = COALESCE(NULLIF(EXCLUDED.releaser, ''), safetrust.trustless_work_escrows.releaser),
    network    = COALESCE(NULLIF(TRIM(safetrust.trustless_work_escrows.network), ''), NULLIF(TRIM(EXCLUDED.network), '')),
    updated_at = NOW()
  WHERE (
    -- 1. Terminal state protection: completed, resolved, cancelled cannot be overwritten
    safetrust.trustless_work_escrows.status NOT IN ('completed', 'resolved', 'cancelled')
    -- 2. Unversioned snapshot policy: only write to pending records
    AND safetrust.trustless_work_escrows.status IN ('created', 'pending_funding')
    -- 3. Transition rules: illegal transitions rejected regardless of sequence
    AND (
      safetrust.trustless_work_escrows.status = EXCLUDED.status
      OR (
        ${SQL_TRANSITION_RULES}
      )
    )
    -- 4. Network identity check: stored network (if known) must match incoming network (if known)
    AND (
      safetrust.trustless_work_escrows.network IS NULL
      OR NULLIF(TRIM(safetrust.trustless_work_escrows.network), '') IS NULL
      OR EXCLUDED.network IS NULL
      OR NULLIF(TRIM(EXCLUDED.network), '') IS NULL
      OR LOWER(REGEXP_REPLACE(safetrust.trustless_work_escrows.network, '^stellar:', '', 'i')) =
         LOWER(REGEXP_REPLACE(EXCLUDED.network, '^stellar:', '', 'i'))
    )
    -- 5. Value difference check: unchanged values produce no write
    AND (
      safetrust.trustless_work_escrows.status,
      safetrust.trustless_work_escrows.amount,
      safetrust.trustless_work_escrows.balance,
      safetrust.trustless_work_escrows.marker,
      safetrust.trustless_work_escrows.approver,
      safetrust.trustless_work_escrows.releaser
    ) IS DISTINCT FROM (
      EXCLUDED.status,
      EXCLUDED.amount,
      EXCLUDED.balance,
      COALESCE(NULLIF(EXCLUDED.marker, ''), safetrust.trustless_work_escrows.marker),
      COALESCE(NULLIF(EXCLUDED.approver, ''), safetrust.trustless_work_escrows.approver),
      COALESCE(NULLIF(EXCLUDED.releaser, ''), safetrust.trustless_work_escrows.releaser)
    )
  )
  RETURNING contract_id, (xmax = 0) AS inserted
`

const UPSERT_ESCROW_WITH_SEQ_SQL = `
  INSERT INTO safetrust.trustless_work_escrows (
    contract_id,
    status,
    amount,
    balance,
    marker,
    approver,
    releaser,
    escrow_type,
    ledger_seq,
    network,
    updated_at,
    tenant_id
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), 'safetrust')
  ON CONFLICT (contract_id)
  DO UPDATE SET
    status     = EXCLUDED.status,
    amount     = EXCLUDED.amount,
    balance    = EXCLUDED.balance,
    marker     = COALESCE(NULLIF(EXCLUDED.marker, ''), safetrust.trustless_work_escrows.marker),
    approver   = COALESCE(NULLIF(EXCLUDED.approver, ''), safetrust.trustless_work_escrows.approver),
    releaser   = COALESCE(NULLIF(EXCLUDED.releaser, ''), safetrust.trustless_work_escrows.releaser),
    ledger_seq = EXCLUDED.ledger_seq,
    network    = COALESCE(NULLIF(TRIM(safetrust.trustless_work_escrows.network), ''), NULLIF(TRIM(EXCLUDED.network), '')),
    updated_at = NOW()
  WHERE (
    -- 1. Terminal state protection: completed, resolved, cancelled cannot be overwritten
    safetrust.trustless_work_escrows.status NOT IN ('completed', 'resolved', 'cancelled')
    -- 2. Incoming newer: EXCLUDED.ledger_seq > stored or stored IS NULL
    AND (
      safetrust.trustless_work_escrows.ledger_seq IS NULL
      OR EXCLUDED.ledger_seq > safetrust.trustless_work_escrows.ledger_seq
    )
    -- 3. Transition rules: illegal transitions rejected regardless of sequence
    AND (
      safetrust.trustless_work_escrows.status = EXCLUDED.status
      OR (
        ${SQL_TRANSITION_RULES}
      )
    )
    -- 4. Network identity check: stored network (if known) must match incoming network (if known)
    AND (
      safetrust.trustless_work_escrows.network IS NULL
      OR NULLIF(TRIM(safetrust.trustless_work_escrows.network), '') IS NULL
      OR EXCLUDED.network IS NULL
      OR NULLIF(TRIM(EXCLUDED.network), '') IS NULL
      OR LOWER(REGEXP_REPLACE(safetrust.trustless_work_escrows.network, '^stellar:', '', 'i')) =
         LOWER(REGEXP_REPLACE(EXCLUDED.network, '^stellar:', '', 'i'))
    )
    -- 5. Value difference check: unchanged values produce no write (ledger_seq advancement included)
    AND (
      safetrust.trustless_work_escrows.ledger_seq,
      safetrust.trustless_work_escrows.status,
      safetrust.trustless_work_escrows.amount,
      safetrust.trustless_work_escrows.balance,
      safetrust.trustless_work_escrows.marker,
      safetrust.trustless_work_escrows.approver,
      safetrust.trustless_work_escrows.releaser
    ) IS DISTINCT FROM (
      EXCLUDED.ledger_seq,
      EXCLUDED.status,
      EXCLUDED.amount,
      EXCLUDED.balance,
      COALESCE(NULLIF(EXCLUDED.marker, ''), safetrust.trustless_work_escrows.marker),
      COALESCE(NULLIF(EXCLUDED.approver, ''), safetrust.trustless_work_escrows.approver),
      COALESCE(NULLIF(EXCLUDED.releaser, ''), safetrust.trustless_work_escrows.releaser)
    )
  )
  RETURNING contract_id, (xmax = 0) AS inserted
`

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Split `arr` into consecutive sub-arrays of at most `size` elements.
 *
 * @param arr   Source array.
 * @param size Maximum chunk length (must be > 0).
 * @returns   Array of chunks.
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (!Array.isArray(arr)) throw new TypeError('chunkArray: arr must be an array')
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('chunkArray: size must be a positive integer')
  }

  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

/**
 * Lightweight HTTP/HTTPS GET helper — uses Node's built-in modules so that
 * no extra runtime dependency is required.
 *
 * @param url  Absolute URL (http or https).
 * @param headers Additional request headers.
 * @returns Parsed JSON response body.
 */
function httpGet(
  url: string,
  headers: Record<string, string> = {},
  retries = 3,
  delayMs = 250,
  maxTotalTimeoutMs = 45_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + maxTotalTimeoutMs

  const attempt = (attemptsLeft: number, currentDelay: number): Promise<Record<string, unknown>> => {
    const remainingTime = deadline - Date.now()
    if (remainingTime <= 0) {
      return Promise.reject(new Error(`TrustlessWork API request exceeded total budget of ${maxTotalTimeoutMs} ms`))
    }

    return new Promise((resolve, reject) => {
      const parsed = new URL(url)
      const transport = parsed.protocol === 'https:' ? https : http

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
      }

      const reqTimeout = Math.min(30_000, Math.max(1_000, remainingTime))

      const req = transport.request(options, (res) => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => { raw += chunk })
        res.on('end', () => {
          const status = res.statusCode || 0
          if (status >= 500 && attemptsLeft > 0 && Date.now() + currentDelay < deadline) {
            return setTimeout(() => {
              attempt(attemptsLeft - 1, currentDelay * 2).then(resolve, reject)
            }, currentDelay)
          }

          if (status < 200 || status >= 300) {
            return reject(
              new Error(
                `TrustlessWork API responded with status ${res.statusCode}: ${raw}`
              )
            )
          }
          try {
            resolve(JSON.parse(raw))
          } catch (e) {
            reject(new Error(`Failed to parse TrustlessWork API response: ${(e as Error).message}`))
          }
        })
      })

      req.on('error', (err) => {
        if (attemptsLeft > 0 && Date.now() + currentDelay < deadline) {
          setTimeout(() => {
            attempt(attemptsLeft - 1, currentDelay * 2).then(resolve, reject)
          }, currentDelay)
        } else {
          reject(err)
        }
      })

      req.setTimeout(reqTimeout, () => {
        req.destroy(new Error(`TrustlessWork API request timed out after ${reqTimeout} ms`))
      })
      req.end()
    })
  }

  return attempt(retries, delayMs)
}

/**
 * Fetch escrow data from the TrustlessWork indexer for a batch of contract IDs.
 *
 * Endpoint: GET /helper/get-escrows-by-contract-ids?contractIds=id1,id2,...
 *
 * @param contractIds  Array of contract IDs (max CHUNK_SIZE).
 * @returns   Array of escrow objects from the indexer.
 */
export async function fetchEscrowsByContractIds(contractIds: string[]): Promise<EscrowRecord[]> {
  const qs = encodeURIComponent(contractIds.join(','))
  const url = `${TW_BASE_URL}/helper/get-escrows-by-contract-ids?contractIds=${qs}`

  const data = await httpGet(url)

  // The API may return { escrows: [...] } or a bare array — handle both.
  if (Array.isArray(data)) return data as unknown as EscrowRecord[]
  if (Array.isArray((data as Record<string, unknown>).escrows)) {
    return (data as Record<string, unknown>).escrows as EscrowRecord[]
  }

  throw new Error(
    `Unexpected TrustlessWork API response shape: ${JSON.stringify(data).slice(0, 200)}`
  )
}

/**
 * Upsert an array of escrow objects into safetrust.trustless_work_escrows.
 *
 * Escrows whose indexed fields have not changed are skipped (IS DISTINCT FROM).
 * Each escrow is processed independently so one bad record does not abort the
 * batch. Shared by the sequential path ({@link syncChunk}) and the Rust parallel
 * path ({@link syncChunksParallel}) so both write identical columns with
 * identical counting — the only difference is how the escrows were fetched.
 *
 * @param escrows  Escrow objects as returned by the indexer.
 */
export async function upsertEscrows(escrows: EscrowRecord[]): Promise<UpsertResult> {
  let updated = 0
  let unchanged = 0
  let skipped = 0

  for (const escrow of escrows) {
    // Guard: contract_id is mandatory — skip malformed records.
    if (!escrow?.contractId) {
      console.warn('[reconciliation] ⚠️  Skipping escrow without contractId:', escrow)
      skipped++
      continue
    }

    try {
      const seq = escrow.ledgerSeq ?? escrow.ledger_seq
      let result
      if (seq !== undefined && seq !== null) {
        const parsedSeq = typeof seq === 'bigint' ? seq.toString() : seq
        result = await db.query<{ contract_id: string }>(UPSERT_ESCROW_WITH_SEQ_SQL, [
          escrow.contractId,                   // $1 contract_id
          escrow.status ?? 'created',          // $2 status
          escrow.amount ?? 0,                  // $3 amount
          escrow.balance ?? 0,                 // $4 balance
          escrow.roles?.marker ?? '',          // $5 marker
          escrow.roles?.approver ?? '',        // $6 approver
          escrow.roles?.releaser ?? '',        // $7 releaser
          escrow.escrowType ?? 'single_release', // $8 escrow_type
          parsedSeq,                           // $9 ledger_seq
          escrow.network ?? null,              // $10 network
        ])
      } else {
        result = await db.query<{ contract_id: string }>(UPSERT_ESCROW_SQL, [
          escrow.contractId,                   // $1 contract_id
          escrow.status ?? 'created',          // $2 status
          escrow.amount ?? 0,                  // $3 amount
          escrow.balance ?? 0,                 // $4 balance
          escrow.roles?.marker ?? '',          // $5 marker
          escrow.roles?.approver ?? '',        // $6 approver
          escrow.roles?.releaser ?? '',        // $7 releaser
          escrow.escrowType ?? 'single_release', // $8 escrow_type
          escrow.network ?? null,              // $9 network
        ])
      }

      // RETURNING only fires when a row was actually changed.
      if (result.rows.length > 0) {
        updated++
      } else {
        unchanged++
        if (seq !== undefined && seq !== null) {
          try {
            const checkRes = await db.query<{ ledger_seq: string | null; status: string; balance: string }>(
              `SELECT ledger_seq, status, balance::text FROM safetrust.trustless_work_escrows WHERE contract_id = $1`,
              [escrow.contractId]
            )
            if (checkRes && checkRes.rows.length > 0) {
              const stored = checkRes.rows[0]
              const incomingSeq = typeof seq === 'bigint' ? seq.toString() : String(seq)
              if (stored.ledger_seq !== null && stored.ledger_seq.toString() === incomingSeq) {
                const incStatus = (escrow.status ?? 'created').trim().toLowerCase()
                const storedStatus = (stored.status ?? '').trim().toLowerCase()
                const incBal = escrow.balance !== undefined ? String(escrow.balance) : '0'
                const storedBal = stored.balance !== undefined ? String(stored.balance) : '0'
                if (incStatus !== storedStatus || !balancesEqual(incBal, storedBal)) {
                  console.warn(
                    `[reconciliation] ⚠️  Equal-sequence conflict on contract "${escrow.contractId}" at seq ${incomingSeq}: ` +
                    `stored status="${stored.status}", balance="${stored.balance}"; ` +
                    `incoming status="${escrow.status}", balance="${escrow.balance}". Preserving stored confirmed state.`
                  )
                }
              }
            }
          } catch {
            // Ignore check error; record counted as unchanged
          }
        }
      }
    } catch (rowError) {
      // Isolate per-row errors — log and count as skipped.
      console.error(
        `[reconciliation] ⚠️  Row error for contract_id "${escrow.contractId}":`,
        (rowError as Error).message
      )
      skipped++
    }
  }

  return { updated, unchanged, skipped }
}

/**
 * Bulk path: fold the whole batch into a single UNNEST UPSERT via the Rust
 * addon. Malformed records (no contractId) are filtered out first and counted as
 * skipped, matching {@link upsertEscrows}. The addon's rows_affected maps to
 * `updated` and its unchanged count to `unchanged`, because the statement's
 * IS DISTINCT FROM guard is identical to UPSERT_ESCROW_SQL. Throws if the addon
 * is unavailable or the statement fails, so the caller can fall back.
 *
 * @param escrows
 */
export async function upsertEscrowsBulk(escrows: EscrowRecord[]): Promise<UpsertResult> {
  const addon = loadBulkUpsert()
  if (!addon) {
    throw new Error('pg-bulk-upsert addon not loaded')
  }

  let skipped = 0
  const valid: EscrowRecord[] = []
  for (const escrow of escrows) {
    if (!escrow?.contractId) {
      console.warn('[reconciliation] ⚠️  Skipping escrow without contractId:', escrow)
      skipped++
      continue
    }
    valid.push(escrow)
  }

  if (valid.length === 0) {
    return { updated: 0, unchanged: 0, skipped }
  }

  // Map to the addon's row shape, applying the same defaults as upsertEscrows so
  // the counts match. Numeric columns are stringified to preserve DECIMAL(20,7)
  // precision across the boundary.
  const updates: BulkUpsertRow[] = valid.map((escrow) => {
    const row: BulkUpsertRow = {
      contract_id: escrow.contractId,
      status: escrow.status ?? 'created',
      amount: String(escrow.amount ?? 0),
      balance: String(escrow.balance ?? 0),
      marker: escrow.roles?.marker ?? '',
      approver: escrow.roles?.approver ?? '',
      releaser: escrow.roles?.releaser ?? '',
      escrow_type: escrow.escrowType ?? 'single_release',
    }
    const seq = escrow.ledgerSeq ?? escrow.ledger_seq
    if (seq !== undefined && seq !== null) {
      row.ledger_seq = typeof seq === 'bigint' ? seq.toString() : seq
    }
    if (escrow.network) {
      row.network = escrow.network
    }
    return row
  })

  // bulkUpsertEscrows returns a Promise<string> — awaiting it keeps the Node
  // event loop free while tokio-postgres runs the statement.
  const resultJson = await addon.bulkUpsertEscrows(
    JSON.stringify(updates),
    buildConnectionString()
  )
  const result: BulkUpsertResult = JSON.parse(resultJson)

  return {
    updated: result.rows_affected,
    unchanged: result.unchanged,
    skipped,
  }
}

/**
 * Upsert a batch of escrow objects, choosing the Rust bulk path when
 * RUST_BULK_UPSERT_ENABLED=true and the addon loads, otherwise the row-by-row
 * {@link upsertEscrows}. Both return the same shape and counts. Any bulk failure
 * (addon missing, bad credentials, statement error) degrades safely to
 * row-by-row, so a batch is never lost.
 *
 * @param escrows
 */
export async function upsertEscrowBatch(escrows: EscrowRecord[]): Promise<UpsertResult> {
  if (!isRustBulkUpsertEnabled() || escrows.length === 0) {
    return upsertEscrows(escrows)
  }
  try {
    return await upsertEscrowsBulk(escrows)
  } catch (err) {
    console.error(
      `[reconciliation] ⚠️  Bulk upsert failed, using row-by-row: ${(err as Error).message}`
    )
    return upsertEscrows(escrows)
  }
}

/**
 * Fetch one chunk of contract IDs from the indexer and upsert the results.
 *
 * Thin composition of {@link fetchEscrowsByContractIds} + {@link upsertEscrowBatch};
 * a network failure rejects so the caller can isolate this chunk from the rest.
 *
 * @param contractIds  Up to CHUNK_SIZE contract IDs.
 */
export async function syncChunk(contractIds: string[]): Promise<UpsertResult> {
  const escrows = await fetchEscrowsByContractIds(contractIds)
  return upsertEscrowBatch(escrows)
}

/**
 * Fetch every chunk concurrently via the Rust addon, then upsert each chunk's
 * escrows in JavaScript. Preserves the chunk-isolation contract: a chunk whose
 * HTTP request failed is recorded in `errors` and never aborts the others.
 *
 * @param chunks  Pre-split contract-id chunks.
 */
export async function syncChunksParallel(chunks: string[][]): Promise<ChunkSyncResult> {
  const addon = loadChunkProcessor()
  if (!addon) {
    // Signal the caller to fall back to the sequential path.
    throw new Error('chunk-processor addon not loaded')
  }

  const concurrency = envInt('CHUNK_CONCURRENCY', 5)
  const timeoutMs = envInt('CHUNK_TIMEOUT_MS', 5000)

  // processChunksParallel returns a Promise<string> — awaiting it keeps the
  // Node event loop free while the Rust runtime does the concurrent fetches.
  const resultsJson = await addon.processChunksParallel(
    JSON.stringify(chunks),
    TW_BASE_URL,
    TW_API_KEY,
    concurrency,
    timeoutMs
  )

  const chunkResults: ChunkResult[] = JSON.parse(resultsJson)

  let updated = 0
  let unchanged = 0
  let skipped = 0
  const errors: string[] = []

  for (const result of chunkResults) {
    if (result.error) {
      // A failed chunk mirrors the sequential path's per-chunk catch.
      errors.push(`chunk_${result.chunk_index}: ${result.error}`)
      continue
    }
    const counts = await upsertEscrowBatch(result.escrows || [])
    updated += counts.updated
    unchanged += counts.unchanged
    skipped += counts.skipped
    console.log(
      `[reconciliation]   chunk ${result.chunk_index + 1}/${chunks.length}` +
        ` (${chunks[result.chunk_index]?.length ?? 0} ids, ${result.duration_ms}ms) —` +
        ` updated: ${counts.updated}, unchanged: ${counts.unchanged}, skipped: ${counts.skipped}`
    )
  }

  return { updated, unchanged, skipped, errors }
}

/**
 * Sync all chunks for a set of contract IDs, choosing the Rust parallel path
 * when RUST_CHUNKS_ENABLED=true and the addon loads, otherwise the sequential
 * loop. Both paths return the same aggregate shape and identical counts.
 *
 * @param contractIds  All contract IDs to reconcile.
 */
export async function syncAllChunks(contractIds: string[]): Promise<SyncAllResult> {
  const chunks = chunkArray(contractIds, CHUNK_SIZE)
  if (chunks.length === 0) {
    return { chunks: 0, updated: 0, unchanged: 0, skipped: 0, errors: [] }
  }

  // ── Rust parallel path (opt-in) ─────────────────────────────────────────────
  if (isRustChunkProcessingEnabled()) {
    try {
      const r = await syncChunksParallel(chunks)
      return { chunks: chunks.length, ...r }
    } catch (err) {
      // Any addon-level failure degrades safely to the sequential loop below.
      console.error(
        `[reconciliation] ⚠️  Parallel chunk path failed, using sequential: ${(err as Error).message}`
      )
    }
  }

  // ── Sequential path (default) ───────────────────────────────────────────────
  let updated = 0
  let unchanged = 0
  let skipped = 0
  const errors: string[] = []

  for (let i = 0; i < chunks.length; i++) {
    try {
      const r = await syncChunk(chunks[i])
      updated += r.updated
      unchanged += r.unchanged
      skipped += r.skipped
      console.log(
        `[reconciliation]   chunk ${i + 1}/${chunks.length}` +
          ` (${chunks[i].length} ids) — updated: ${r.updated}, unchanged: ${r.unchanged}, skipped: ${r.skipped}`
      )
    } catch (chunkError) {
      const errMsg = (chunkError as Error).message || String(chunkError)
      console.error(
        `[reconciliation] ⚠️  Chunk ${i + 1}/${chunks.length} failed: ${errMsg}`
      )
      errors.push(`chunk_${i}: ${errMsg}`)
    }
  }

  return { chunks: chunks.length, updated, unchanged, skipped, errors }
}

/**
 * Find escrows not updated by TrustlessWork in the last N days.
 * Uses the partial index idx_trustless_escrows_updated_at for O(log n + k) lookup.
 *
 * Big O:
 *   Index scan on updated_at: O(log n) to find range start
 *   Row retrieval: O(k) where k = number of stale rows
 *   Total: O(log n + k), far better than O(n) full table scan
 *
 * Terminal statuses (completed, resolved, cancelled) are excluded — they never
 * need stale detection and are omitted from the partial index.
 *
 * @param staleDays - escrows not updated in this many days are stale (default 7)
 * @returns contract_ids of stale escrows
 */
export async function findStaleEscrows(staleDays = 7): Promise<string[]> {
  if (!Number.isFinite(staleDays) || staleDays < 1) {
    throw new RangeError('findStaleEscrows: staleDays must be a positive number')
  }

  const { rows } = await db.query<{ contract_id: string }>(
    `SELECT contract_id
       FROM safetrust.trustless_work_escrows
      WHERE tenant_id = 'safetrust'
        AND status NOT IN ('completed', 'resolved', 'cancelled')
        AND updated_at < NOW() - ($1 * INTERVAL '1 day')
      ORDER BY updated_at ASC`,
    [staleDays]
  )

  return rows.map((r) => r.contract_id)
}

/**
 * True only for PostgreSQL errors where retrying against the unqualified table
 * name is a legitimate recovery: `42P01` (undefined_table) or `3F000`
 * (invalid_schema_name). Every other error — lock/statement timeout, deadlock,
 * constraint violation — must propagate unchanged so the original cause is not
 * masked by a misleading "relation does not exist" from the fallback query.
 */
function isUndefinedTableError(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code
  return code === '42P01' || code === '3F000'
}

/**
 * Atomic freshness reconciliation for a single escrow record using explicit row-level locking.
 *
 * Implements the atomic transaction pattern:
 * ```sql
 * BEGIN;
 * SELECT ledger_seq, status FROM escrow_transactions WHERE id = $1 FOR UPDATE;
 * -- compare in application code
 * UPDATE escrow_transactions SET status = $2, balance = $3, ledger_seq = $4 WHERE id = $1;
 * COMMIT;
 * ```
 */
export async function reconcileEscrowAtomic(
  escrow: EscrowRecord,
  providedClient?: PoolClient
): Promise<FreshnessOutcome> {
  const isCustomClient = Boolean(providedClient)
  const client =
    providedClient ?? (typeof connect === 'function' ? await connect() : null)

  const executeQuery = async (
    sql: string,
    params: any[] = []
  ): Promise<{ rows: any[] }> => {
    if (client) {
      return client.query(sql, params)
    }
    return db.query(sql, params)
  }

  let txOpen = false
  try {
    await executeQuery('BEGIN')
    txOpen = true

    const selectSql = `
      SELECT contract_id, status, balance::text, ledger_seq, network
      FROM safetrust.trustless_work_escrows
      WHERE contract_id = $1
      FOR UPDATE
    `
    let storedRow: any = null
    await executeQuery('SAVEPOINT sp_select')
    try {
      const res = await executeQuery(selectSql, [escrow.contractId])
      storedRow = res.rows[0]
      await executeQuery('RELEASE SAVEPOINT sp_select')
    } catch (err) {
      await executeQuery('ROLLBACK TO SAVEPOINT sp_select')
      if (!isUndefinedTableError(err)) throw err
      const fallbackSql = `
        SELECT contract_id, status, balance::text, ledger_seq, network
        FROM trustless_work_escrows
        WHERE contract_id = $1
        FOR UPDATE
      `
      const res = await executeQuery(fallbackSql, [escrow.contractId])
      storedRow = res.rows[0]
    }

    const storedState: StoredEscrowState | null = storedRow
      ? {
          contractId: storedRow.contract_id,
          status: storedRow.status,
          balance: storedRow.balance ?? '0.0000000',
          ledgerSeq: storedRow.ledger_seq,
          network: storedRow.network,
        }
      : null

    const incoming: IncomingEscrowObservation = {
      contractId: escrow.contractId,
      status: escrow.status ?? 'created',
      balance: escrow.balance ?? (storedState?.balance ?? '0.0000000'),
      amount: escrow.amount,
      ledgerSeq: escrow.ledgerSeq ?? escrow.ledger_seq,
      network: escrow.network,
    }

    const outcome = evaluateFreshness(storedState, incoming)
    // Effective outcome returned to the caller. Reassigned only when a losing
    // insert race (below) forces a re-evaluation against the winner's row.
    let finalOutcome: FreshnessOutcome = outcome

    // Re-read the winner's row under lock after losing an insert race, then
    // reconcile the losing observation against it (apply an UPDATE only if the
    // re-evaluation still calls for a WRITE).
    const reconcileLostInsertRace = async (): Promise<FreshnessOutcome> => {
      let raceRow: any = null
      await executeQuery('SAVEPOINT sp_race_select')
      try {
        const res = await executeQuery(
          `SELECT contract_id, status, balance::text, ledger_seq, network
             FROM safetrust.trustless_work_escrows
            WHERE contract_id = $1 FOR UPDATE`,
          [escrow.contractId]
        )
        raceRow = res.rows[0]
        await executeQuery('RELEASE SAVEPOINT sp_race_select')
      } catch (err) {
        await executeQuery('ROLLBACK TO SAVEPOINT sp_race_select')
        if (!isUndefinedTableError(err)) throw err
        const res = await executeQuery(
          `SELECT contract_id, status, balance::text, ledger_seq, network
             FROM trustless_work_escrows
            WHERE contract_id = $1 FOR UPDATE`,
          [escrow.contractId]
        )
        raceRow = res.rows[0]
      }

      if (!raceRow) {
        // Row vanished between the failed insert and the re-read (e.g. rolled
        // back by the winner). Nothing to reconcile.
        return { type: 'IDEMPOTENT_UNCHANGED' }
      }

      const raceStored: StoredEscrowState = {
        contractId: raceRow.contract_id,
        status: raceRow.status,
        balance: raceRow.balance ?? '0.0000000',
        ledgerSeq: raceRow.ledger_seq,
        network: raceRow.network,
      }
      const raceOutcome = evaluateFreshness(raceStored, incoming)
      if (raceOutcome.type !== 'WRITE') {
        return raceOutcome
      }

      const raceUpdateParams = [
        escrow.contractId,
        raceOutcome.status,
        raceOutcome.balance,
        raceOutcome.ledgerSeq ? raceOutcome.ledgerSeq.toString() : null,
        escrow.network ?? null,
      ]
      await executeQuery('SAVEPOINT sp_race_update')
      try {
        await executeQuery(
          `UPDATE safetrust.trustless_work_escrows
              SET status = $2, balance = $3::numeric, ledger_seq = $4,
                  network = COALESCE(safetrust.trustless_work_escrows.network, $5),
                  updated_at = NOW()
            WHERE contract_id = $1`,
          raceUpdateParams
        )
        await executeQuery('RELEASE SAVEPOINT sp_race_update')
      } catch (err) {
        await executeQuery('ROLLBACK TO SAVEPOINT sp_race_update')
        if (!isUndefinedTableError(err)) throw err
        await executeQuery(
          `UPDATE trustless_work_escrows
              SET status = $2, balance = $3::numeric, ledger_seq = $4,
                  network = COALESCE(trustless_work_escrows.network, $5),
                  updated_at = NOW()
            WHERE contract_id = $1`,
          raceUpdateParams
        )
      }
      return raceOutcome
    }

    if (outcome.type === 'WRITE') {
      if (storedRow) {
        const updateSql = `
          UPDATE safetrust.trustless_work_escrows
          SET status = $2, balance = $3::numeric, ledger_seq = $4,
              network = COALESCE(safetrust.trustless_work_escrows.network, $5),
              updated_at = NOW()
          WHERE contract_id = $1
        `
        await executeQuery('SAVEPOINT sp_update')
        try {
          await executeQuery(updateSql, [
            escrow.contractId,
            outcome.status,
            outcome.balance,
            outcome.ledgerSeq ? outcome.ledgerSeq.toString() : null,
            escrow.network ?? null,
          ])
          await executeQuery('RELEASE SAVEPOINT sp_update')
        } catch (err) {
          await executeQuery('ROLLBACK TO SAVEPOINT sp_update')
          if (!isUndefinedTableError(err)) throw err
          const fallbackUpdate = `
            UPDATE trustless_work_escrows
            SET status = $2, balance = $3::numeric, ledger_seq = $4,
                network = COALESCE(trustless_work_escrows.network, $5),
                updated_at = NOW()
            WHERE contract_id = $1
          `
          await executeQuery(fallbackUpdate, [
            escrow.contractId,
            outcome.status,
            outcome.balance,
            outcome.ledgerSeq ? outcome.ledgerSeq.toString() : null,
            escrow.network ?? null,
          ])
        }
      } else {
        // No stored row yet. SELECT ... FOR UPDATE locked nothing, so two
        // concurrent first-observations can both reach this INSERT. Make it
        // conflict-tolerant: the loser gets zero rows back and must re-read the
        // winner's row and reconcile against it, rather than blindly retrying
        // the insert (issue #661: safe handling of concurrent writers).
        const insertParams = [
          escrow.contractId,
          outcome.status,
          escrow.amount ? formatExactBalance(escrow.amount) : outcome.balance,
          outcome.balance,
          escrow.roles?.marker ?? '',
          escrow.roles?.approver ?? '',
          escrow.roles?.releaser ?? '',
          escrow.escrowType ?? 'single_release',
          outcome.ledgerSeq ? outcome.ledgerSeq.toString() : null,
          escrow.network ?? null,
        ]
        const insertSql = `
          INSERT INTO safetrust.trustless_work_escrows (
            contract_id, status, amount, balance, marker, approver, releaser,
            escrow_type, ledger_seq, network, updated_at, tenant_id
          ) VALUES (
            $1, $2, $3::numeric, $4::numeric, $5, $6, $7, $8, $9, $10, NOW(), 'safetrust'
          )
          ON CONFLICT (contract_id) DO NOTHING
          RETURNING contract_id
        `
        let insertRes: { rows: any[] }
        await executeQuery('SAVEPOINT sp_insert')
        try {
          insertRes = await executeQuery(insertSql, insertParams)
          await executeQuery('RELEASE SAVEPOINT sp_insert')
        } catch (err) {
          await executeQuery('ROLLBACK TO SAVEPOINT sp_insert')
          if (!isUndefinedTableError(err)) throw err
          const fallbackInsert = `
            INSERT INTO trustless_work_escrows (
              contract_id, status, amount, balance, marker, approver, releaser,
              escrow_type, ledger_seq, network, updated_at, tenant_id
            ) VALUES (
              $1, $2, $3::numeric, $4::numeric, $5, $6, $7, $8, $9, $10, NOW(), 'safetrust'
            )
            ON CONFLICT (contract_id) DO NOTHING
            RETURNING contract_id
          `
          insertRes = await executeQuery(fallbackInsert, insertParams)
        }

        if (insertRes.rows.length === 0) {
          // Lost the insert race: a concurrent writer created the row first.
          // Re-read it under lock and reconcile the losing observation against
          // the winner's state instead of dropping it.
          finalOutcome = await reconcileLostInsertRace()
        }
      }
    }

    await executeQuery('COMMIT')
    txOpen = false
    return finalOutcome
  } catch (err) {
    if (txOpen) {
      try {
        await executeQuery('ROLLBACK')
      } catch {
        // ignore rollback error
      }
    }
    throw err
  } finally {
    if (client && !isCustomClient && typeof (client as any).release === 'function') {
      (client as any).release()
    }
  }
}

// ─── Durable Retry Helpers ───────────────────────────────────────────────────

/**
 * Calculates exponential backoff bounded by maxMs.
 * Formula: min(baseMs * 2^(attemptCount - 1), maxMs)
 */
export function calculateRetryBackoff(
  attemptCount: number,
  baseMs = 1000,
  maxMs = 300_000
): number {
  if (attemptCount <= 0) return 0
  const exp = Math.min(attemptCount - 1, 30)
  const delay = baseMs * Math.pow(2, exp)
  return Math.min(delay, maxMs)
}

/**
 * Fetches pending confirmation retries that are scheduled for execution.
 */
export async function fetchPendingConfirmationRetries(limit = 50): Promise<Array<{
  id: string
  tx_hash: string
  escrow_id: string
  escrow_action: string
  network: string
  submission_path: string
  attempt_count: number
  max_attempts: number
  next_retry_at: string
  last_error: string | null
}>> {
  const { rows } = await db.query<any>(
    `SELECT id, tx_hash, escrow_id, escrow_action, network, submission_path,
            attempt_count, max_attempts, next_retry_at, last_error
       FROM safetrust.escrow_confirmation_retries
      WHERE status = 'retrying'
        AND next_retry_at <= NOW()
      ORDER BY next_retry_at ASC
      LIMIT $1`,
    [limit]
  )
  return rows
}
