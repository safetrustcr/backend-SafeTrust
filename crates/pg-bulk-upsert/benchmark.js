'use strict'

/**
 * Row-by-row vs bulk UPSERT benchmark / smoke test for the pg-bulk-upsert addon.
 *
 * It talks to a real PostgreSQL, so it measures the thing that actually matters:
 * round trips. It:
 *
 *   1. creates a scratch database with a `public.trustless_work_escrows` table
 *      shaped like the real one,
 *   2. seeds N rows,
 *   3. times the row-by-row path (N separate UPSERT statements via node-postgres,
 *      the same statement reconciliation.js runs today),
 *   4. resets the rows and times the bulk path (one addon call, one statement),
 *   5. asserts the two report the same `updated` count, and that a second bulk
 *      call touches zero rows (the IS DISTINCT FROM guard).
 *
 * Connection defaults to 127.0.0.1:5432 postgres/postgrespassword; override with
 * PGHOST / PGPORT / PGUSER / PGPASSWORD. Run:
 *
 *   node crates/pg-bulk-upsert/benchmark.js
 */

const path = require('path')
const assert = require('assert')
const crypto = require('crypto')

// The addon.
const { bulkUpsertEscrows } = require('./index.node')

// node-postgres lives in webhook/node_modules; resolve it from there so this
// script runs from the repo root without its own install.
function loadPg() {
  try {
    return require('pg')
  } catch {
    return require(path.resolve(__dirname, '..', '..', 'webhook', 'node_modules', 'pg'))
  }
}
const { Client } = loadPg()

const HOST = process.env.PGHOST || '127.0.0.1'
const PORT = process.env.PGPORT || '5432'
const USER = process.env.PGUSER || 'postgres'
const PASS = process.env.PGPASSWORD || 'postgrespassword'
const N = Number(process.env.BENCH_ROWS || 500)
// Unique, identifier-safe name per run so the benchmark never drops a pre-existing
// database on a shared server — it only ever creates and cleans up its own.
const BENCH_DB = `pg_bulk_upsert_bench_${crypto.randomBytes(6).toString('hex')}`

const adminConn = { host: HOST, port: Number(PORT), user: USER, password: PASS, database: 'postgres' }
const benchConnObj = { host: HOST, port: Number(PORT), user: USER, password: PASS, database: BENCH_DB }
const benchConnStr = `postgresql://${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}@${HOST}:${PORT}/${BENCH_DB}`

// The exact per-row statement reconciliation.js uses today.
const ROW_UPSERT_SQL = `
  INSERT INTO public.trustless_work_escrows
    (contract_id, status, amount, balance, marker, approver, releaser, escrow_type, updated_at, tenant_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'safetrust')
  ON CONFLICT (contract_id) DO UPDATE SET
    status = EXCLUDED.status, amount = EXCLUDED.amount, balance = EXCLUDED.balance,
    marker = EXCLUDED.marker, approver = EXCLUDED.approver, releaser = EXCLUDED.releaser,
    updated_at = NOW()
  WHERE (
    public.trustless_work_escrows.status, public.trustless_work_escrows.amount,
    public.trustless_work_escrows.balance, public.trustless_work_escrows.marker,
    public.trustless_work_escrows.approver, public.trustless_work_escrows.releaser
  ) IS DISTINCT FROM (
    EXCLUDED.status, EXCLUDED.amount, EXCLUDED.balance,
    EXCLUDED.marker, EXCLUDED.approver, EXCLUDED.releaser
  )
  RETURNING contract_id
`

const CREATE_TABLE_SQL = `
  CREATE TABLE public.trustless_work_escrows (
    contract_id VARCHAR(255) UNIQUE NOT NULL,
    marker      VARCHAR(255) NOT NULL,
    approver    VARCHAR(255) NOT NULL,
    releaser    VARCHAR(255) NOT NULL,
    escrow_type VARCHAR(50)  NOT NULL,
    status      VARCHAR(50)  NOT NULL,
    amount      DECIMAL(20,7) NOT NULL,
    balance     DECIMAL(20,7) DEFAULT 0,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    tenant_id   VARCHAR(255) NOT NULL DEFAULT 'safetrust'
  )
`

function ids() {
  return Array.from({ length: N }, (_, i) => `BENCH_${String(i).padStart(5, '0')}`)
}

// Escrow rows with a given balance, in the addon's row shape.
function updatesWithBalance(balance) {
  return ids().map((id) => ({
    contract_id: id, status: 'funded', amount: '100.0000000', balance,
    marker: 'M', approver: 'A', releaser: 'R', escrow_type: 'single_release',
  }))
}

async function resetRows(client) {
  // Set every row back to balance 0 so both paths do the same amount of work
  // (they all change 0 -> 100).
  await client.query('UPDATE public.trustless_work_escrows SET balance = 0')
}

async function seed(client) {
  await client.query('TRUNCATE public.trustless_work_escrows')
  const rows = updatesWithBalance('0')
  // One bulk insert to establish the initial state (not part of the measurement).
  await client.query(
    `INSERT INTO public.trustless_work_escrows
       (contract_id, status, amount, balance, marker, approver, releaser, escrow_type, tenant_id)
     SELECT u.contract_id, u.status, u.amount::numeric, u.balance::numeric,
            u.marker, u.approver, u.releaser, u.escrow_type, 'safetrust'
     FROM UNNEST($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[])
       AS u(contract_id, status, amount, balance, marker, approver, releaser, escrow_type)`,
    [
      rows.map((r) => r.contract_id), rows.map((r) => r.status), rows.map((r) => r.amount),
      rows.map((r) => r.balance), rows.map((r) => r.marker), rows.map((r) => r.approver),
      rows.map((r) => r.releaser), rows.map((r) => r.escrow_type),
    ]
  )
}

async function runRowByRow(client) {
  const updates = updatesWithBalance('100.0000000')
  const start = Date.now()
  let updated = 0
  for (const u of updates) {
    const res = await client.query(ROW_UPSERT_SQL, [
      u.contract_id, u.status, u.amount, u.balance, u.marker, u.approver, u.releaser, u.escrow_type,
    ])
    if (res.rowCount > 0) updated++
  }
  return { durationMs: Date.now() - start, updated }
}

async function runBulk() {
  const updates = updatesWithBalance('100.0000000')
  const start = Date.now()
  const result = JSON.parse(await bulkUpsertEscrows(JSON.stringify(updates), benchConnStr))
  return { durationMs: Date.now() - start, result }
}

async function main() {
  // Create the scratch database. The name is unique per run, so there is nothing
  // pre-existing to drop — we only ever create and (in finally) remove our own.
  const admin = new Client(adminConn)
  await admin.connect()
  await admin.query(`CREATE DATABASE ${BENCH_DB}`)
  await admin.end()

  const client = new Client(benchConnObj)
  await client.connect()
  try {
    await client.query(CREATE_TABLE_SQL)

    console.log('pg-bulk-upsert benchmark')
    console.log('-'.repeat(52))
    console.log(`rows=${N}  db=${BENCH_DB}  host=${HOST}:${PORT}\n`)

    // Row-by-row path.
    await seed(client)
    const seq = await runRowByRow(client)

    // Bulk path (same work: reset rows to 0 first).
    await resetRows(client)
    const bulk = await runBulk()

    // Correctness: both change every row.
    assert.strictEqual(seq.updated, N, 'row-by-row updated every row')
    assert.strictEqual(bulk.result.rows_affected, N, 'bulk updated every row')
    assert.strictEqual(bulk.result.unchanged, 0, 'nothing unchanged on first bulk pass')

    // Idempotency: a second identical bulk pass must touch zero rows.
    const second = await runBulk()
    assert.strictEqual(second.result.rows_affected, 0, 'second bulk pass changes nothing')
    assert.strictEqual(second.result.unchanged, N, 'second bulk pass reports all unchanged')

    const speedup = (seq.durationMs / bulk.durationMs).toFixed(2)
    console.log(`  row-by-row (${N} statements) : ${seq.durationMs} ms`)
    console.log(`  bulk       (1 statement)     : ${bulk.durationMs} ms`)
    console.log(`  speedup                      : ${speedup}x\n`)
    console.log('correctness + idempotency assertions passed')
  } finally {
    await client.end()
    const cleanup = new Client(adminConn)
    await cleanup.connect()
    await cleanup.query(`DROP DATABASE IF EXISTS ${BENCH_DB} WITH (FORCE)`)
    await cleanup.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
