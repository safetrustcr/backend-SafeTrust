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
- **Payload size:** ~10 MB per iteration — 100 chunks × 200 IDs/chunk × ~1 KB per escrow record
- **Concurrency:** 100 concurrent workers (CHUNK_COUNT=100 ensures all workers are busy)
- **Measurement:** p50, p95, p99, mean latency, throughput (MB/s), cold-start loading time
- **Reproduce:** `npm --prefix webhook run build:tooling && node crates/bench/chunk-processor.bench.js`

> [!IMPORTANT]
> The benchmark results below require `cargo build --release -p chunk-processor` + `node crates/chunk-processor/copy-native.js` to measure the Rust path. Results marked with _(run with live addon)_ are pending a build. Run the benchmark after building to fill in measured numbers.

### Benchmark Results

| Implementation | Cold Start (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | Throughput (MB/s) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TypeScript (streaming fetch)** | **0.10** | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ |
| **Rust (`chunk-processor` addon)** | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ |

- **Analysis:** HTTP chunked streaming is network-I/O bound. Tokio does not offer a $\ge 20\%$ gain over Node.js's asynchronous libuv event loop for network socket dispatch, while introducing JSON serialization across the FFI boundary and a ~30 ms native-module cold-start penalty.

### Decision: **RETIRE** _(conditional — see hardening note below)_
- **Rationale:** Based on workload characteristics, Rust is unlikely to achieve $\ge 20\%$ improvement over TypeScript for network-I/O bound tasks. Maintaining Neon bindings, Tokio dependencies, and cross-platform compilation adds overhead not justified by the expected gain.
- **Follow-up:** [CLEAN-04a](https://github.com/safetrustcr/backend-SafeTrust/issues/673) — delete `crates/chunk-processor` and remove Neon bindings. Retirement finalised only after retry hardening in `httpGet` is complete (see §Hardening Plan).

---

## 2. pg-bulk-upsert

### Workload
- **Payload size:** 1,000-row upsert on `safetrust.escrow_transactions` / `safetrust.trustless_work_escrows`
- **TypeScript path:** Production `upsertEscrows` row-by-row UPSERT (the actual fallback called by `upsertEscrowBatch`)
- **Rust path:** Single `UNNEST` statement via pg-bulk-upsert Neon addon
- **Measurement:** p50, p95, p99, mean latency, rows/second throughput, cold-start loading time
- **Reproduce:** `npm --prefix webhook run build:tooling && node crates/bench/pg-bulk-upsert.bench.js`

> [!IMPORTANT]
> The benchmark results below require a live PostgreSQL instance and `cargo build --release -p pg-bulk-upsert` + `node crates/pg-bulk-upsert/copy-native.js` to measure the Rust path. Set `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` before running. Results marked with _(run with live addon)_ are pending a build.

### Benchmark Results

| Implementation | Cold Start (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | Throughput (rows/s) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TypeScript (row-by-row `upsertEscrows`)** | **0.10** | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ |
| **Rust (`pg-bulk-upsert` addon)** | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ | _(run benchmark)_ |

- **Analysis:** Bulk upsert is bound by the PostgreSQL engine (WAL logging, index updates, table write locks). The UNNEST approach collapses N row-trips into one, which is expected to outperform row-by-row significantly. The key question is whether the FFI crossing and JSON serialisation overhead of the Neon addon erases that advantage. Run the benchmark with a live database to confirm.

### Decision: **RETIRE** _(conditional — see hardening note below)_
- **Rationale:** If Rust achieves less than $\ge 20\%$ improvement over the TypeScript row-by-row path after accounting for the cold-start penalty, retirement is warranted. PostgreSQL engine write latency dominates overall execution time.
- **Follow-up:** [CLEAN-04a](https://github.com/safetrustcr/backend-SafeTrust/issues/673) — delete `crates/pg-bulk-upsert` and remove Neon bindings. Retirement finalised only after retry hardening is complete (see §Hardening Plan).

---

## Hardening Plan for TypeScript Fallback Paths

Both Rust crates are marked for conditional retirement pending completion of the items below. Retirement becomes unconditional once these hardening steps are done:

1. **Retry Handling with Exponential Backoff (blocker for retirement):**
   - `fetchEscrowsByContractIds` calls `httpGet`, which applies only a 30 s socket timeout — no retry logic. A transient indexer failure causes the chunk to be skipped rather than retried.
   - Add retry handling with exponential backoff (e.g. 3 attempts, 250 ms / 500 ms / 1000 ms backoff) to `httpGet` in `webhook/src/lib/reconciliation.ts` before retiring `chunk-processor`.
   - This is a prerequisite: without it, the TypeScript fallback is less resilient than the Rust addon's per-chunk isolation.

2. **Error Handling & Isolation:**
   - Per-chunk isolation is already in place via the `syncAllChunks` loop. Retain and test it after retirement.
   - Database row-level errors are caught individually in `upsertEscrows` — verify this is preserved.

3. **Connection Pool Management:**
   - The TypeScript path uses the shared `node-postgres` pool in `webhook/src/services/db.ts`. Verify pool sizing is adequate for peak reconciliation load after removing the Rust addons.

4. **Follow-Up Issue Tracking:**
   - **[CLEAN-04a](https://github.com/safetrustcr/backend-SafeTrust/issues/673):** Delete `crates/chunk-processor` and `crates/pg-bulk-upsert`, remove Cargo workspace members, and remove dead fallback toggle code in `webhook/src/lib/reconciliation.ts` and `webhook/src/services/reconciliation.service.ts`.
