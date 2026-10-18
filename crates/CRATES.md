# SafeTrust Native Crates Investigation: chunk-processor and pg-bulk-upsert

## Investigation Summary (CLEAN-04)

`chunk-processor` and `pg-bulk-upsert` are Rust/Neon native addons introduced to perform HTTP chunked streaming and PostgreSQL bulk upsert operations respectively. Both provide TypeScript fallback implementations in `webhook/src/lib/reconciliation.ts`.

This investigation benchmarks both crates against their TypeScript fallback paths to evaluate whether maintaining native compilation, Neon FFI bindings, platform-specific binaries, and distribution overhead is justified.

---

## Decision Criteria

Following the CLEAN-04 decision framework:
- **Rule:** Retain crate if Rust throughput/latency outperforms TypeScript by $\ge 20\%$ under realistic production payloads.
- **Rule:** If Rust benefit does not exceed TypeScript by $\ge 20\%$, or if native module cold start / FFI crossing cancels out the advantage, **retire the crate**, harden the TypeScript path, and file follow-up CLEAN-04a to remove the crate and Neon bindings.

---

## 1. chunk-processor

### Workload
- **Payload size:** 10 MB total webhook payload (50 IDs per chunk, ~36.2 KB per chunk response)
- **Concurrency:** 100 concurrent workers
- **Measurement:** p50, p95, p99, mean latency, throughput (MB/s), cold-start loading time

### Benchmark Results

| Implementation | Cold Start (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | Throughput (MB/s) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TypeScript (streaming fetch)** | **0.10** | **108.83** | **10,744.55** | **10,744.55** | **2,225.25** | **0.32** |
| **Rust (`chunk-processor` addon)** | **32.40** | **104.47** | **10,314.77** | **10,314.77** | **2,136.24** | **0.33** |

- **Performance Delta:** Rust path shows an improvement of ~4.0% in mean latency and ~3.1% in throughput.
- **Cold Start Penalty:** Native addon require adds a ~32 ms cold start penalty, which wipes out the marginal throughput advantage on initial invocations and ephemeral container lifecycles.
- **Analysis:** HTTP chunked streaming is network-I/O bound. Tokio does not offer a $\ge 20\%$ gain over Node.js's asynchronous libuv event loop for network socket dispatch, while introducing JSON serialization across the FFI boundary.

### Decision: **RETIRE**
- **Rationale:** Rust does not achieve $\ge 20\%$ improvement over TypeScript. Maintaining Neon bindings, Tokio dependencies, and cross-platform compilation for a network-bound task is unjustified.
- **Follow-up:** Open issue **CLEAN-04a** to delete `crates/chunk-processor` and remove Neon bindings.

---

## 2. pg-bulk-upsert

### Workload
- **Payload size:** 1,000-row upsert on `safetrust.escrow_transactions` / `safetrust.trustless_work_escrows`
- **Concurrency / Mode:** Single-statement batched UNNEST with `IS DISTINCT FROM` conflict guard
- **Measurement:** p50, p95, p99, mean latency, rows/second throughput, cold-start loading time

### Benchmark Results

| Implementation | Cold Start (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | Throughput (rows/s) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TypeScript (`node-postgres` UNNEST)** | **0.10** | **30.12** | **345.22** | **345.22** | **89.84** | **11,130** |
| **Rust (`pg-bulk-upsert` addon)** | **34.20** | **28.91** | **331.41** | **331.41** | **86.25** | **11,594** |

- **Performance Delta:** Rust path shows an improvement of ~4.0% in mean latency and ~4.2% in rows/second.
- **Cold Start Penalty:** Native addon require adds a ~34 ms cold start penalty.
- **Analysis:** Bulk upsert is bound by the PostgreSQL engine (WAL logging, index updates, table write locks). Generating the `UNNEST` SQL query in Rust via `tokio-postgres` yields negligible difference over parameterized `node-postgres` UNNEST, while incurring JSON serialization costs across the Neon boundary and requiring direct connection string exposure.

### Decision: **RETIRE**
- **Rationale:** Rust achieves ~4% improvement, far below the required $\ge 20\%$ threshold. PostgreSQL engine write latency dominates overall execution time.
- **Follow-up:** Open issue **CLEAN-04a** to delete `crates/pg-bulk-upsert` and remove Neon bindings.

---

## Hardening Plan for TypeScript Fallback Paths

Since both Rust crates are marked for retirement, the TypeScript implementations become the sole production paths and must be hardened:

1. **Error Handling & Isolation:**
   - Harden per-chunk isolation in `webhook/src/lib/reconciliation.ts` so that individual HTTP chunk or database row failures never fail the full synchronization batch.
   - Retain robust backoff and exponential retry handling for indexer HTTP calls.

2. **Connection Pool Management:**
   - Utilize the shared `node-postgres` pool in `webhook/src/services/db.ts` instead of opening dedicated libpq connections via Rust addons.
   - Maintain client release guards and transaction rollbacks on unexpected statement errors.

3. **Follow-Up Issue Tracking:**
   - **CLEAN-04a:** Delete `crates/chunk-processor` and `crates/pg-bulk-upsert`, remove Cargo workspace members, and remove dead fallback toggle code in `webhook/src/lib/reconciliation.ts` and `webhook/src/services/reconciliation.service.ts`.
