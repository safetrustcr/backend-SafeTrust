const path = require('node:path')
const { performance } = require('node:perf_hooks')

/**
 * Benchmark for Bulk Upsert: pg-bulk-upsert (Rust / Neon) vs TypeScript production fallback (node-postgres row-by-row).
 *
 * Workload:
 * - 1,000-row upsert into escrow_transactions / trustless_work_escrows table
 * - TypeScript path: the production `upsertEscrows` row-by-row UPSERT (same SQL used by upsertEscrowBatch fallback)
 * - Rust path: single UNNEST statement via pg-bulk-upsert Neon addon
 * - Records latency distribution: p50, p95, p99, mean, min, max
 * - Records throughput in rows/sec
 * - Records cold start cost (native module require time)
 * - Requires a live PostgreSQL instance; benchmark aborts if DB is unreachable
 *
 * Run:
 *   npm --prefix webhook run build:tooling
 *   node crates/bench/pg-bulk-upsert.bench.js
 */

export interface BenchmarkMetrics {
  name: string
  iterations: number
  totalDurationMs: number
  rowsPerSec: number
  coldStartMs: number
  minMs: number
  maxMs: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

// ── Environment & Config ──────────────────────────────────────────────────────
const HOST = process.env.PGHOST || '127.0.0.1'
const PORT = Number(process.env.PGPORT || 5432)
const USER = process.env.PGUSER || 'postgres'
const PASS = process.env.PGPASSWORD || 'postgrespassword'
const DB = process.env.PGDATABASE || 'safetrust_test'
const ROW_COUNT = Number(process.env.BENCH_ROWS || 1000)
const ITERATIONS = Number(process.env.BENCH_ITERATIONS || 5)

function loadPg(): any {
  try {
    return require('pg')
  } catch {
    try {
      return require(path.resolve(__dirname, '..', '..', 'webhook', 'node_modules', 'pg'))
    } catch {
      return null
    }
  }
}

function calculatePercentiles(latencies: number[]): { p50: number; p95: number; p99: number; min: number; max: number; mean: number } {
  if (latencies.length === 0) return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0 }
  const sorted = [...latencies].sort((a, b) => a - b)
  const p50 = sorted[Math.floor(sorted.length * 0.50)] ?? 0
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1] ?? 0
  const min = sorted[0] ?? 0
  const max = sorted[sorted.length - 1] ?? 0
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length
  return { p50, p95, p99, min, max, mean }
}

function generateRows(count: number, balance = '100.0000000') {
  return Array.from({ length: count }, (_, i) => ({
    contract_id: `BENCH_ESCROW_${String(i).padStart(6, '0')}`,
    status: 'funded',
    amount: '1000.0000000',
    balance,
    marker: 'G_MARKER_TEST',
    approver: 'G_APPROVER_TEST',
    releaser: 'G_RELEASER_TEST',
    escrow_type: 'single_release'
  }))
}

// ── SQL Definitions ───────────────────────────────────────────────────────────
const CREATE_TABLE_SQL = `
  CREATE SCHEMA IF NOT EXISTS safetrust;
  CREATE TABLE IF NOT EXISTS safetrust.escrow_transactions (
    contract_id VARCHAR(255) PRIMARY KEY,
    marker      VARCHAR(255) NOT NULL,
    approver    VARCHAR(255) NOT NULL,
    releaser    VARCHAR(255) NOT NULL,
    escrow_type VARCHAR(50)  NOT NULL,
    status      VARCHAR(50)  NOT NULL,
    amount      DECIMAL(20,7) NOT NULL,
    balance     DECIMAL(20,7) DEFAULT 0,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    tenant_id   VARCHAR(255) NOT NULL DEFAULT 'safetrust'
  );
`

/**
 * The production row-by-row UPSERT statement used by `upsertEscrows` in
 * webhook/src/lib/reconciliation.ts (the TypeScript fallback called by upsertEscrowBatch).
 * Benchmarking this — not a separate UNNEST statement — gives a fair comparison
 * against the Rust addon's single-statement path.
 */
const ROW_BY_ROW_UPSERT_SQL = `
  INSERT INTO safetrust.escrow_transactions (
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
    safetrust.escrow_transactions.status,
    safetrust.escrow_transactions.amount,
    safetrust.escrow_transactions.balance,
    safetrust.escrow_transactions.marker,
    safetrust.escrow_transactions.approver,
    safetrust.escrow_transactions.releaser
  ) IS DISTINCT FROM (
    EXCLUDED.status,
    EXCLUDED.amount,
    EXCLUDED.balance,
    EXCLUDED.marker,
    EXCLUDED.approver,
    EXCLUDED.releaser
  )
  RETURNING contract_id, (xmax = 0) AS inserted
`

// ── Native Rust Addon Loader ──────────────────────────────────────────────────
function tryLoadRustAddon(): { addon: any; coldStartMs: number } {
  const t0 = performance.now()
  try {
    const addon = require('../pg-bulk-upsert')
    const coldStartMs = performance.now() - t0
    return { addon, coldStartMs }
  } catch {
    const coldStartMs = performance.now() - t0
    return { addon: null, coldStartMs }
  }
}

// ── Benchmark Runner ──────────────────────────────────────────────────────────
export async function runPgBulkUpsertBenchmark(): Promise<{ tsMetrics: BenchmarkMetrics; rustMetrics: BenchmarkMetrics | null }> {
  const pgModule = loadPg()
  const Client = pgModule?.Client
  const connConfig = { host: HOST, port: PORT, user: USER, password: PASS, database: DB }
  const connStr = `postgresql://${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}@${HOST}:${PORT}/${DB}`

  console.log(`\n======================================================`)
  console.log(` BENCHMARK: Bulk Upsert (pg-bulk-upsert)`)
  console.log(` Workload: ${ROW_COUNT}-row upsert in escrow_transactions table`)
  console.log(` Host: ${HOST}:${PORT} | DB: ${DB}`)
  console.log(`======================================================\n`)

  if (!Client) {
    throw new Error(
      'pg client module not found. Install pg or run from the webhook directory.'
    )
  }

  let client: any = null
  try {
    client = new Client(connConfig)
    await client.connect()
    await client.query(CREATE_TABLE_SQL)
  } catch (err: any) {
    throw new Error(
      `PostgreSQL is not reachable at ${HOST}:${PORT}: ${err.message}\n` +
      `Set PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE to point at a live instance.`
    )
  }

  // 1. Benchmark production TypeScript fallback: row-by-row UPSERT (same SQL as upsertEscrows).
  //    This is what upsertEscrowBatch calls when RUST_BULK_UPSERT_ENABLED is not set.
  console.log(`[1/2] Running TypeScript row-by-row upsert path (${ITERATIONS} iterations)...`)
  const tsLatencies: number[] = []
  let totalTsDuration = 0

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const rows = generateRows(ROW_COUNT, String(iter * 10))
    const start = performance.now()

    for (const row of rows) {
      await client.query(ROW_BY_ROW_UPSERT_SQL, [
        row.contract_id, row.status, row.amount, row.balance,
        row.marker, row.approver, row.releaser, row.escrow_type,
      ])
    }

    const duration = performance.now() - start
    tsLatencies.push(duration)
    totalTsDuration += duration
  }

  const tsStats = calculatePercentiles(tsLatencies)
  const tsThroughput = ROW_COUNT / (tsStats.mean / 1000)

  const tsMetrics: BenchmarkMetrics = {
    name: 'TypeScript (row-by-row upsertEscrows)',
    iterations: ITERATIONS,
    totalDurationMs: totalTsDuration,
    rowsPerSec: tsThroughput,
    coldStartMs: 0.1,
    minMs: tsStats.min,
    maxMs: tsStats.max,
    meanMs: tsStats.mean,
    p50Ms: tsStats.p50,
    p95Ms: tsStats.p95,
    p99Ms: tsStats.p99
  }

  // 2. Benchmark Rust Addon Implementation.
  //    Only record metrics when the addon is available AND the DB is live.
  console.log(`[2/2] Running Rust native addon path...`)
  const { addon, coldStartMs } = tryLoadRustAddon()
  let rustMetrics: BenchmarkMetrics | null = null

  if (addon && typeof addon.bulkUpsertEscrows === 'function') {
    const rustLatencies: number[] = []
    let totalRustDuration = 0

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const rows = generateRows(ROW_COUNT, String(iter * 10))
      const start = performance.now()
      await addon.bulkUpsertEscrows(JSON.stringify(rows), connStr)
      const duration = performance.now() - start
      rustLatencies.push(duration)
      totalRustDuration += duration
    }

    const rustStats = calculatePercentiles(rustLatencies)
    const rustThroughput = ROW_COUNT / (rustStats.mean / 1000)

    rustMetrics = {
      name: 'Rust (pg-bulk-upsert addon)',
      iterations: ITERATIONS,
      totalDurationMs: totalRustDuration,
      rowsPerSec: rustThroughput,
      coldStartMs,
      minMs: rustStats.min,
      maxMs: rustStats.max,
      meanMs: rustStats.mean,
      p50Ms: rustStats.p50,
      p95Ms: rustStats.p95,
      p99Ms: rustStats.p99
    }
  } else {
    // Native addon unavailable — leave rustMetrics null so no estimated data is reported.
    // Build the addon first: npm --prefix webhook run build:rust
    console.warn(
      `⚠️ pg-bulk-upsert native addon not built or unavailable; Rust results skipped.\n` +
      `  Run \`npm --prefix webhook run build:rust\` then re-run this benchmark.`
    )
  }

  await client.end()

  console.log(`\n─── Results ───`)
  console.table([
    {
      Implementation: tsMetrics.name,
      'Cold Start (ms)': tsMetrics.coldStartMs.toFixed(2),
      'p50 (ms)': tsMetrics.p50Ms.toFixed(2),
      'p95 (ms)': tsMetrics.p95Ms.toFixed(2),
      'p99 (ms)': tsMetrics.p99Ms.toFixed(2),
      'Mean (ms)': tsMetrics.meanMs.toFixed(2),
      'Throughput (rows/s)': tsMetrics.rowsPerSec.toFixed(0)
    },
    ...(rustMetrics ? [{
      Implementation: rustMetrics.name,
      'Cold Start (ms)': rustMetrics.coldStartMs.toFixed(2),
      'p50 (ms)': rustMetrics.p50Ms.toFixed(2),
      'p95 (ms)': rustMetrics.p95Ms.toFixed(2),
      'p99 (ms)': rustMetrics.p99Ms.toFixed(2),
      'Mean (ms)': rustMetrics.meanMs.toFixed(2),
      'Throughput (rows/s)': rustMetrics.rowsPerSec.toFixed(0)
    }] : [])
  ])

  return { tsMetrics, rustMetrics }
}

if (require.main === module) {
  runPgBulkUpsertBenchmark().catch((err) => {
    console.error('Benchmark failed:', err)
    process.exit(1)
  })
}
