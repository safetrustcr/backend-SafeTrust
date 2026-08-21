# chunk-processor ⚡

Rust-native, concurrent escrow-chunk fetcher for the SafeTrust reconciliation
service, exposed to Node.js via **Neon** (Node-API v6).

It replaces the sequential `for` loop in
[`webhook/src/lib/reconciliation.js`](../../webhook/src/lib/reconciliation.js)
that calls the TrustlessWork indexer one chunk at a time. Each chunk is an
independent HTTP round-trip, so total sync time is dominated by network latency
paid **serially**. This addon issues those requests concurrently on Tokio's
async executor — without blocking Node's event loop per request — collapsing
`N × latency` into roughly `latency` (bounded by `CHUNK_CONCURRENCY`).

## What it provides

| JS export              | Signature |
| ---------------------- | --------- |
| `processChunksParallel` | `(chunksJson: string, apiUrl: string, apiKey: string, maxConcurrency: number, timeoutMs: number) => string` |

`chunksJson` is a JSON-encoded `string[][]` (array of contract-id chunks). The
return value is a JSON-encoded `ChunkSyncResult[]`, one entry per chunk, ordered
by `chunk_index`:

```ts
interface ChunkSyncResult {
  chunk_index: number
  fetched: number       // escrow objects returned for this chunk
  duration_ms: number   // wall-clock time for this chunk's request
  error: string | null  // non-null when the chunk failed (isolated)
  escrows: unknown[]     // raw indexer objects, passed through verbatim
}
```

See [`index.d.ts`](./index.d.ts) for the full typed contract.

## Design contract (matches the JavaScript path it replaces)

- **Chunk isolation** — a failed chunk is captured in `error` and never aborts
  the others. The addon only throws for a caller bug (malformed `chunksJson`).
- **Lossless pass-through** — escrow objects are returned exactly as the indexer
  sent them, so the existing UPSERT keeps writing every column (`amount`,
  `roles.{marker,approver,releaser}`, `escrowType`, …). The DB layer stays in JS.
- **Response-shape tolerance** — accepts both `{ "escrows": [...] }` and a bare
  `[...]`, exactly like `fetchEscrowsByContractIds`.
- **Bounded concurrency** — at most `maxConcurrency` requests are in flight
  (streaming via `buffer_unordered`, not batch barriers). `0` is clamped to `1`.
- **Hard per-chunk timeout** — enforced twice: the reqwest per-request timeout
  and an outer `tokio::time::timeout`, so a chunk always resolves within
  `timeoutMs`.

## Enabling it

Gated behind an environment flag; default behaviour is unchanged.

```bash
RUST_CHUNKS_ENABLED=true   # opt in to the parallel path
CHUNK_CONCURRENCY=5        # max in-flight chunk requests (default 5)
CHUNK_TIMEOUT_MS=5000      # hard per-chunk timeout (default 5000)
```

If the addon is missing or fails to load, the service logs a warning and falls
back to the sequential loop — the endpoint never breaks.

## Build

Prerequisites: Rust toolchain (`cargo`). Targets Node-API v6 (ABI-stable across
Node versions — no per-Node rebuilds). TLS is via **rustls**, so no system
OpenSSL is required (clean build on Alpine/musl).

```bash
# From the repo root — chunk-processor is a workspace member:
cargo build --release -p chunk-processor
node crates/chunk-processor/copy-native.js   # → crates/chunk-processor/index.node

# Or as part of the webhook build (builds both addons + TypeScript):
cd webhook && npm run build
```

The webhook Docker image builds and ships `index.node` automatically
(see [`webhook/Dockerfile`](../../webhook/Dockerfile)).

## Test

```bash
cargo test -p chunk-processor      # pure-logic + concurrency-isolation tests
node crates/chunk-processor/benchmark.js   # sequential vs parallel timing demo
```

`benchmark.js` starts a local HTTP server with simulated indexer latency and
prints the sequential-vs-parallel speedup used in the PR description.
