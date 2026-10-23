import assert = require('node:assert')
import { fork, type ChildProcess } from 'node:child_process'
import type { ChunkSyncResult } from './index'
'use strict'

/**
 * Sequential-vs-parallel benchmark / smoke test for the chunk-processor addon.
 *
 * Spins up a mock TrustlessWork indexer with a fixed per-request latency, then
 * compares:
 *
 *   1. Sequential baseline — one HTTP round-trip per chunk, awaited in order
 *      (what webhook/src/lib/reconciliation.js did before this addon).
 *   2. Parallel — processChunksParallel() with bounded Tokio concurrency.
 *
 * Prints a table of durations and the measured speedup, and asserts the parallel
 * path returns loss-lessly and isolates a deliberately failing chunk.
 *
 * The mock indexer runs in a forked child process. processChunksParallel() no
 * longer blocks the event loop (it returns a Promise), so an in-process server
 * would also work; the child is kept purely to isolate the mock's own latency
 * timers from the measured loop.
 *
 * Run:  node crates/chunk-processor/benchmark.js
 * (Requires `cargo build --release -p chunk-processor && node ../scripts/copy-native.js --crate=chunk-processor`.)
 */

import http = require('node:http')

// ── Tunables (env-overridable) ────────────────────────────────────────────────
const LATENCY_MS = Number(process.env.BENCH_LATENCY_MS || 300) // per-request delay
const CHUNKS = Number(process.env.BENCH_CHUNKS || 10) // number of chunks
const CHUNK_SIZE = Number(process.env.BENCH_CHUNK_SIZE || 50) // ids per chunk
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY || 5)
const TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS || 5000)

// ── Child mode: run the mock indexer, report its port over IPC ────────────────
if (process.env.BENCH_MODE === 'server') {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const ids = (url.searchParams.get('contractIds') || '').split(',').filter(Boolean)
    const escrows = ids.map((id) => ({
      contractId: id,
      status: 'funded',
      amount: '100.0000000',
      balance: '50.0000000',
      escrowType: 'single_release',
      roles: { marker: 'M', approver: 'A', releaser: 'R' },
    }))
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ escrows }))
    }, LATENCY_MS)
  })
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (address && typeof address !== 'string') process.send?.({ port: address.port })
  })
} else {

// ── Parent mode: orchestrate the benchmark ────────────────────────────────────


const { processChunksParallel }: typeof import('./index') = require('./index.node')

function buildChunks() {
  const chunks = []
  for (let c = 0; c < CHUNKS; c++) {
    const ids = []
    for (let i = 0; i < CHUNK_SIZE; i++) ids.push(`C_${c}_${i}`)
    chunks.push(ids)
  }
  return chunks
}

function startMockIndexer() {
  return new Promise<{ child: ChildProcess; baseUrl: string }>((resolve) => {
    const child = fork(__filename, { env: { ...process.env, BENCH_MODE: 'server' } })
    child.once('message', (message) => {
      if (!message || typeof message !== 'object' || !('port' in message) || typeof message.port !== 'number') { child.kill(); return }
      const { port } = message
      resolve({ child, baseUrl: `http://127.0.0.1:${port}` })
    })
  })
}

function fetchChunkSequential(baseUrl: string, chunk: string[]) {
  return new Promise<unknown[]>((resolve, reject) => {
    const qs = encodeURIComponent(chunk.join(','))
    const url = `${baseUrl}/helper/get-escrows-by-contract-ids?contractIds=${qs}`
    http
      .get(url, (res) => {
        let raw = ''
        res.on('data', (d) => (raw += d))
        res.on('end', () => resolve(JSON.parse(raw).escrows))
      })
      .on('error', reject)
  })
}

async function runSequential(baseUrl: string, chunks: string[][]) {
  const start = Date.now()
  let fetched = 0
  for (const chunk of chunks) {
    const escrows = await fetchChunkSequential(baseUrl, chunk)
    fetched += escrows.length
  }
  return { durationMs: Date.now() - start, fetched }
}

async function runParallel(baseUrl: string, chunks: string[][]) {
  const start = Date.now()
  const json = await processChunksParallel(
    JSON.stringify(chunks),
    baseUrl,
    '', // no api key for the mock
    CONCURRENCY,
    TIMEOUT_MS
  )
  const results: ChunkSyncResult[] = JSON.parse(json)
  const fetched = results.reduce((n, r) => n + r.fetched, 0)
  return { durationMs: Date.now() - start, fetched, results }
}

async function main() {
  const { child, baseUrl } = await startMockIndexer()
  try {
    const chunks = buildChunks()
    const totalIds = CHUNKS * CHUNK_SIZE

    console.log('chunk-processor benchmark')
    console.log('─'.repeat(52))
    console.log(`chunks=${CHUNKS}  chunkSize=${CHUNK_SIZE}  ids=${totalIds}`)
    console.log(`latency=${LATENCY_MS}ms  concurrency=${CONCURRENCY}\n`)

    const seq = await runSequential(baseUrl, chunks)
    const par = await runParallel(baseUrl, chunks)

    // Correctness: both paths fetch every id, lossless pass-through.
    assert.strictEqual(seq.fetched, totalIds, 'sequential fetched all ids')
    assert.strictEqual(par.fetched, totalIds, 'parallel fetched all ids')
    assert.strictEqual(par.results.length, CHUNKS, 'one result per chunk')
    assert.deepStrictEqual(
      par.results[0].escrows[0],
      {
        contractId: 'C_0_0',
        status: 'funded',
        amount: '100.0000000',
        balance: '50.0000000',
        escrowType: 'single_release',
        roles: { marker: 'M', approver: 'A', releaser: 'R' },
      },
      'escrow object passed through verbatim'
    )

    // Isolation: an unreachable base URL must yield per-chunk errors, no throw.
    const failed: ChunkSyncResult[] = JSON.parse(
      await processChunksParallel(JSON.stringify(chunks), 'http://127.0.0.1:1', '', CONCURRENCY, 500)
    )
    assert.strictEqual(failed.length, CHUNKS)
    assert.ok(failed.every((r) => r.error), 'every chunk records its own error')

    const speedup = (seq.durationMs / par.durationMs).toFixed(2)
    console.log(`  sequential : ${seq.durationMs} ms`)
    console.log(`  parallel   : ${par.durationMs} ms`)
    console.log(`  speedup    : ${speedup}x\n`)
    console.log('✅ correctness + isolation assertions passed')
  } finally {
    child.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

}
