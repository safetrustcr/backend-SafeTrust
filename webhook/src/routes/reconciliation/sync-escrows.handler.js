'use strict';

/**
 * @file src/routes/reconciliation/sync-escrows.handler.js
 * @description POST /reconciliation/sync-escrows — Hasura cron trigger target.
 *
 * Flow
 * ────
 *  1. SELECT all contract_ids, status, balance, marker, approver from public.trustless_work_escrows (tenant='safetrust')
 *  2. Fetch + upsert every chunk (sequential, or concurrent via the Rust
 *     chunk-processor addon when RUST_CHUNKS_ENABLED=true) — errors are isolated
 *  3. Optional Soroban RPC validation pass (Rust crate crates/soroban-reconciler)
 *  4. Detect stale escrows (updated_at older than N days) via indexed lookup
 *  5. Return 200 with full summary JSON (including Soroban metrics) regardless of partial chunk failures
 */

const db = require('../../services/db');
const { hasuraRequest } = require('../../services/hasura');
const {
  syncAllChunks,
  chunkArray,
  CHUNK_SIZE,
  findStaleEscrows,
} = require('../../lib/reconciliation');

// Rust Soroban reconciler — queries blockchain directly via native addon if available
let queryEscrowStateBatch = null;
let reconcileBatch = null;

try {
  const sorobanReconciler = require('../../../crates/soroban-reconciler');
  queryEscrowStateBatch = sorobanReconciler.queryEscrowStateBatch;
  reconcileBatch = sorobanReconciler.reconcileBatch;
} catch (err) {
  console.warn(
    '[reconciliation] ⚠️ soroban-reconciler native addon unavailable:',
    err.message
  );
}

/** Escrows not updated within this many days are reported as stale. */
const STALE_ESCROW_DAYS = 7;
const NETWORK = process.env.STELLAR_NETWORK ?? 'testnet';

// Enable/disable Soroban validation pass — off by default until Phase 2
const SOROBAN_VALIDATION_ENABLED = process.env.SOROBAN_VALIDATION_ENABLED === 'true';

/**
 * Handle POST /reconciliation/sync-escrows.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function syncEscrowsHandler(req, res) {
  const startTime = Date.now();
  console.log('[reconciliation] 🔄 Starting escrow sync...');

  try {
    // ── Step 1: Fetch all known contract IDs ─────────────────────────────────
    const { rows } = await db.query(
      `SELECT contract_id, status, balance, marker, approver
         FROM public.trustless_work_escrows
        WHERE tenant_id = 'safetrust'`
    );

    if (rows.length === 0) {
      console.log('[reconciliation] ℹ️  No escrows found to sync.');
      return res.status(200).json({
        success: true,
        message: 'No escrows to sync',
        totalEscrows: 0,
        chunks: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        staleCount: 0,
        staleContractIds: [],
        errors: 0,
        sorobanEnabled: SOROBAN_VALIDATION_ENABLED,
        sorobanDrift: 0,
        sorobanCorrected: 0,
        durationMs: Date.now() - startTime,
      });
    }

    const contractIds = rows.map((r) => r.contract_id);
    const dbStateMap = Object.fromEntries(rows.map((r) => [r.contract_id, r]));

    // ── Step 2: TrustlessWork fetch + upsert ──────────────────────────────────
    // syncAllChunks processes the chunks sequentially, or concurrently via the
    // Rust chunk-processor addon when RUST_CHUNKS_ENABLED=true, and isolates
    // per-chunk errors so one failed chunk never aborts the rest.
    const {
      chunks: chunkCount,
      updated: totalUpdated,
      unchanged: totalUnchanged,
      skipped: totalSkipped,
      errors: chunkErrors,
    } = await syncAllChunks(contractIds);

    // ── Step 3: Optional Soroban RPC validation pass (gated by env var) ───────
    // Independent of the fetch above: it compares on-chain state against the
    // pre-sync DB snapshot (dbStateMap) one chunk at a time, and never aborts
    // the sync. Failures are recorded in chunkErrors.
    let totalSorobanDrift = 0;
    let totalSorobanCorrected = 0;

    if (SOROBAN_VALIDATION_ENABLED) {
      const chunks = chunkArray(contractIds, CHUNK_SIZE);
      for (let i = 0; i < chunks.length; i++) {
        try {
          const { drifted, corrected } = await runSorobanValidation(
            chunks[i], dbStateMap, NETWORK
          );
          totalSorobanDrift += drifted;
          totalSorobanCorrected += corrected;

          if (drifted > 0) {
            console.warn(
              `[reconciliation] ⚠️  Soroban drift in chunk ${i + 1}:` +
              ` ${drifted} contracts, ${corrected} auto-corrected`
            );
          }
        } catch (sorobanError) {
          // Soroban validation failure is non-fatal — the TrustlessWork sync already ran.
          console.error(
            `[reconciliation] ⚠️  Soroban validation failed for chunk ${i + 1}:`,
            sorobanError.message
          );
          chunkErrors.push(`soroban_chunk_${i + 1}: ${sorobanError.message}`);
        }
      }
    }

    // ── Step 4: Detect stale escrows (O(log n + k) indexed lookup) ────────────
    const staleContractIds = await findStaleEscrows(STALE_ESCROW_DAYS);
    const staleCount = staleContractIds.length;

    if (staleCount > 0) {
      console.warn(
        `[reconciliation] ⚠️  ${staleCount} escrows not updated in ${STALE_ESCROW_DAYS}+ days:`,
        staleContractIds.slice(0, 5)
      );
    }

    const durationMs = Date.now() - startTime;

    // ── Step 5: Log summary (extended with Soroban metrics) ───────────────────
    console.log(`[reconciliation] ✅ Sync complete in ${durationMs}ms`);
    console.log(`   Total escrows     : ${contractIds.length}`);
    console.log(`   Chunks            : ${chunkCount}`);
    console.log(`   Updated rows      : ${totalUpdated}`);
    console.log(`   Unchanged rows    : ${totalUnchanged}`);
    console.log(`   Skipped rows      : ${totalSkipped}`);
    console.log(`   Stale rows        : ${staleCount}`);
    console.log(`   Soroban drift     : ${totalSorobanDrift}`);
    console.log(`   Soroban corrected : ${totalSorobanCorrected}`);
    if (chunkErrors.length > 0) {
      console.log(`   Chunk errors      : ${chunkErrors.length}`);
    }

    // ── Step 6: Respond 200 (always — matches existing contract) ─────────────
    return res.status(200).json({
      success: true,
      totalEscrows: contractIds.length,
      chunks: chunkCount,
      updated: totalUpdated,
      unchanged: totalUnchanged,
      skipped: totalSkipped,
      staleCount,
      staleContractIds: staleContractIds.slice(0, 10),
      errors: chunkErrors.length,
      sorobanEnabled: SOROBAN_VALIDATION_ENABLED,
      sorobanDrift: totalSorobanDrift,
      sorobanCorrected: totalSorobanCorrected,
      durationMs,
    });
  } catch (fatalError) {
    console.error('[reconciliation] ❌ Fatal error:', fatalError.message);
    return res.status(500).json({
      success: false,
      error: 'Reconciliation failed',
      details: fatalError.message,
    });
  }
}

// ── Soroban validation helper ──────────────────────────────────────────────────

async function runSorobanValidation(chunk, dbStateMap, network) {
  let drifted = 0;
  let corrected = 0;

  if (!queryEscrowStateBatch || !reconcileBatch) {
    throw new Error('soroban-reconciler native addon is not available');
  }

  for (const contractId of chunk) {
    try {
      // Query Soroban RPC via Rust crate
      const onChainJson = queryEscrowStateBatch(contractId, network);
      const onChain = JSON.parse(onChainJson);

      const dbState = dbStateMap[contractId];
      if (!dbState) continue;

      // Compare via Rust diff engine
      const reportJson = reconcileBatch(
        JSON.stringify(onChain),
        JSON.stringify({
          id: dbState.id ?? '',
          contractId: dbState.contract_id,
          status: dbState.status,
          balance: parseFloat(dbState.balance ?? '0'),
          marker: dbState.marker ?? '',
          approver: dbState.approver ?? '',
        })
      );
      const report = JSON.parse(reportJson);

      if (!report.in_sync) {
        drifted++;

        const criticalDiscrepancies = report.discrepancies
          .filter((d) => d.severity === 'critical');

        if (criticalDiscrepancies.length > 0) {
          console.warn(
            `[reconciliation] 🚨 Soroban drift for ${contractId}:`,
            criticalDiscrepancies.map((d) => `${d.field}: ${d.in_database} → ${d.on_chain}`)
          );

          // Auto-correct: update database to match blockchain ground truth
          await hasuraRequest(
            `mutation CorrectDriftFromSoroban(
               $contractId: String!
               $status: String!
               $balance: numeric!
             ) {
               update_trustless_work_escrows(
                 where: { contractId: { _eq: $contractId } }
                 _set: {
                   status:    $status
                   balance:   $balance
                   updatedAt: "now()"
                 }
               ) { affected_rows }
             }`,
            {
              contractId,
              status: onChain.status,
              balance: onChain.balance / 10_000_000,
            }
          );
          corrected++;
        }
      }
    } catch (err) {
      // Per-contract failure is non-fatal inside the Soroban pass
      console.warn(
        `[reconciliation] ⚠️  Soroban skip for ${contractId}: ${err.message}`
      );
    }
  }

  return { drifted, corrected };
}

module.exports = { syncEscrowsHandler };
