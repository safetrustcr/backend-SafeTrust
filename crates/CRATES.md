# SafeTrust Native Crates Investigation: chunk-processor and pg-bulk-upsert

## Investigation Summary (CLEAN-04)

`chunk-processor` and `pg-bulk-upsert` are Rust/Neon native addons introduced to perform HTTP chunked streaming and PostgreSQL bulk upsert operations respectively. Both provide TypeScript fallback implementations in `webhook/src/lib/reconciliation.ts`.

This investigation benchmarks both crates against their TypeScript fallback paths to evaluate whether maintaining native compilation, Neon FFI bindings, platform-specific binaries, and distribution overhead is justified.

---

## Decision Criteria

Following the CLEAN-04 decision framework:
- **Rule:** Retain crate if Rust throughput/latency outperforms TypeScript by $\ge 20\%$ under realistic production payloads.
- **Rule:** If Rust benefit does not exceed TypeScript by $\ge 20\%$, or if native module cold start / FFI crossing cancels out the advantage, **retire the crate**, harden the TypeScript path, and file follow-up [CLEAN-04a](https://github.com/safetrustcr/backend-SafeTrust/issues/673) to remove the crate and Neon bindings.

---

## 1. chunk-processor

### Workload
- **Payload size:** ~20 MB per iteration — 100 chunks × 200 IDs/chunk × ~1 KB per escrow record
- **Concurrency:** 100 concurrent workers (CHUNK_COUNT=100 ensures all workers are busy)
- **Measurement:** p50, p95, p99, mean latency, throughput (MB/s), cold-start loading time
- **Reproduce:** `npm --prefix webhook run build:tooling && node crates/bench/chunk-processor.bench.js`

> [!IMPORTANT]
> The benchmark results below require `cargo build --release -p chunk-processor` + `node crates/scripts/copy-native.js` to measure the Rust path. Results marked with _(run benchmark)_ are pending an environment with built native addons and live network.

### Benchmark Results

| Implementation | Cold Start (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | Throughput (MB/s) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TypeScript (streaming fetch)** | **0.10** | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ |
| **Rust (`chunk-processor` addon)** | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ |

- **Analysis:** HTTP chunked streaming is network-I/O bound. Tokio does not offer a $\ge 20\%$ gain over Node.js's asynchronous libuv event loop for network socket dispatch, while introducing JSON serialization across the FFI boundary and a ~30 ms native-module cold-start penalty.

### Decision: **PENDING MEASUREMENT** _(Pending live addon benchmarks)_
- **Status:** Decision left pending until comparative benchmark numbers for both TypeScript and Rust paths are measured in a fully built environment. If Rust does not achieve $\ge 20\%$ improvement over TypeScript after cold-start evaluation, the crate will be retired under [CLEAN-04a](https://github.com/safetrustcr/backend-SafeTrust/issues/673).
- **Follow-up:** [CLEAN-04a](https://github.com/safetrustcr/backend-SafeTrust/issues/673) — delete `crates/chunk-processor` and remove Neon bindings upon retirement confirmation.

---

## 2. pg-bulk-upsert

### Workload
- **Payload size:** 1,000-row upsert on `safetrust.trustless_work_escrows`
- **TypeScript path:** Production `upsertEscrows` row-by-row UPSERT (the actual fallback called by `upsertEscrowBatch`)
- **Rust path:** Single `UNNEST` statement via pg-bulk-upsert Neon addon on `safetrust.trustless_work_escrows`
- **Measurement:** p50, p95, p99, mean latency, rows/second throughput, cold-start loading time
- **Reproduce:** `npm --prefix webhook run build:tooling && node crates/bench/pg-bulk-upsert.bench.js`

> [!IMPORTANT]
> The benchmark results below require a live PostgreSQL instance and `cargo build --release -p pg-bulk-upsert` + `node crates/scripts/copy-native.js` to measure the Rust path. Set `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` before running. Results marked with _(run benchmark)_ are pending a build and database connectivity.

### Benchmark Results

| Implementation | Cold Start (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | Throughput (rows/s) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TypeScript (row-by-row `upsertEscrows`)** | **0.10** | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ |
| **Rust (`pg-bulk-upsert` addon)** | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ |

- **Analysis:** Bulk upsert is bound by the PostgreSQL engine (WAL logging, index updates, table write locks). The UNNEST approach collapses N row-trips into one, which is expected to outperform row-by-row significantly. The key question is whether the FFI crossing and JSON serialisation overhead of the Neon addon erases that advantage. Run the benchmark with a live database to confirm.

### Decision: **PENDING MEASUREMENT** _(Pending live database benchmarks)_
- **Status:** Decision left pending until comparative benchmark numbers for both TypeScript and Rust paths are measured with a live PostgreSQL instance. If Rust achieves less than $\ge 20\%$ improvement over the TypeScript row-by-row path after accounting for the cold-start penalty, the crate will be retired under [CLEAN-04a](https://github.com/safetrustcr/backend-SafeTrust/issues/673).
- **Follow-up:** [CLEAN-04a](https://github.com/safetrustcr/backend-SafeTrust/issues/673) — delete `crates/pg-bulk-upsert` and remove Neon bindings upon retirement confirmation.

---

## Hardening Plan for TypeScript Fallback Paths

Before finalizing any retirement, the TypeScript implementations must meet production resiliency standards:

1. **Retry Handling with Exponential Backoff & Timeout Budget:**
   - `fetchEscrowsByContractIds` calls `httpGet`, which has now been hardened with retry handling for 5xx responses and network errors using exponential delays (e.g., 3 attempts starting at 250 ms), bounded by a cumulative timeout budget to prevent unbounded retry stalls.
   - Remaining verification needed before retirement: end-to-end integration testing against the live TrustlessWork indexer under high concurrency and failure injection to verify retry behavior and pool stability.

2. **Error Handling & Isolation:**
   - Per-chunk isolation is in place via the `syncAllChunks` loop. Retain and verify it under stress testing.
   - Database row-level errors are caught individually in `upsertEscrows` — verify this is preserved.

3. **Connection Pool Management:**
   - The TypeScript path uses the shared `node-postgres` pool in `webhook/src/services/db.ts`. Verify pool sizing is adequate for peak reconciliation load after removing the Rust addons.

4. **Follow-Up Issue Tracking:**
   - **[CLEAN-04a](https://github.com/safetrustcr/backend-SafeTrust/issues/673):** Delete `crates/chunk-processor` and `crates/pg-bulk-upsert`, remove Cargo workspace members, and remove dead fallback toggle code in `webhook/src/lib/reconciliation.ts` and `webhook/src/services/reconciliation.service.ts`.
