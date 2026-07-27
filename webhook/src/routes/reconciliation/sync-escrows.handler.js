'use strict';

/**
 * @file src/routes/reconciliation/sync-escrows.handler.js
 * @description POST /reconciliation/sync-escrows — Hasura cron trigger target.
 *
 * Flow
 * ────
 *  1. SELECT all contract_ids from public.trustless_work_escrows (tenant='safetrust')
 *  2. Split into chunks of CHUNK_SIZE (50)
 *  3. For each chunk: call TrustlessWork indexer → upsert changed rows only
 *  4. Chunk-level errors are isolated — one failed chunk never aborts others
 *  5. Detect stale escrows (updated_at older than N days) via indexed lookup
 *  6. Return 200 with full summary JSON regardless of partial chunk failures
 */

const db = require('../../services/db');
const {
  chunkArray,
  syncChunk,
  findStaleEscrows,
  CHUNK_SIZE,
} = require('../../lib/reconciliation');

/** Escrows not updated within this many days are reported as stale. */
const STALE_ESCROW_DAYS = 7;

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
    // ── Step 1: Fetch all known contract IDs ────────────────────────────────
    const { rows } = await db.query(
      `SELECT contract_id
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
        durationMs: Date.now() - startTime,
      });
    }

    const contractIds = rows.map((r) => r.contract_id);
    const chunks = chunkArray(contractIds, CHUNK_SIZE);

    let totalUpdated = 0;
    let totalUnchanged = 0;
    let totalSkipped = 0;
    const chunkErrors = [];

    // ── Step 2: Process each chunk independently ────────────────────────────
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const { updated, unchanged, skipped } = await syncChunk(chunk);
        totalUpdated += updated;
        totalUnchanged += unchanged;
        totalSkipped += skipped;
        console.log(
          `[reconciliation]   chunk ${i + 1}/${chunks.length}` +
          ` (${chunk.length} ids) — updated: ${updated}, unchanged: ${unchanged}, skipped: ${skipped}`
        );
      } catch (chunkError) {
        // Isolate chunk-level errors so other chunks still run.
        const errMsg = chunkError.message || String(chunkError);
        console.error(
          `[reconciliation] ⚠️  Chunk ${i + 1}/${chunks.length} failed: ${errMsg}`
        );
        chunkErrors.push(errMsg);
      }
    }

    // ── Step 3: Detect stale escrows (O(log n + k) indexed lookup) ──────────
    const staleContractIds = await findStaleEscrows(STALE_ESCROW_DAYS);
    const staleCount = staleContractIds.length;

    if (staleCount > 0) {
      console.warn(
        `[reconciliation] ⚠️  ${staleCount} escrows not updated in ${STALE_ESCROW_DAYS}+ days:`,
        staleContractIds.slice(0, 5)
      );
    }

    const durationMs = Date.now() - startTime;

    // ── Step 4: Log summary ─────────────────────────────────────────────────
    console.log(`[reconciliation] ✅ Sync complete in ${durationMs}ms`);
    console.log(`   Total escrows : ${contractIds.length}`);
    console.log(`   Chunks        : ${chunks.length}`);
    console.log(`   Updated rows  : ${totalUpdated}`);
    console.log(`   Unchanged rows: ${totalUnchanged}`);
    console.log(`   Skipped rows  : ${totalSkipped}`);
    console.log(`   Stale rows    : ${staleCount}`);
    if (chunkErrors.length > 0) {
      console.log(`   Chunk errors  : ${chunkErrors.length}`);
    }

    // ── Step 5: Respond 200 ─────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      totalEscrows: contractIds.length,
      chunks: chunks.length,
      updated: totalUpdated,
      unchanged: totalUnchanged,
      skipped: totalSkipped,
      staleCount,
      staleContractIds: staleContractIds.slice(0, 10),
      errors: chunkErrors.length,
      durationMs,
    });
  } catch (fatalError) {
    // Only truly unexpected errors (e.g. DB connection failure) reach here.
    console.error('[reconciliation] ❌ Fatal error:', fatalError.message);
    return res.status(500).json({
      success: false,
      error: 'Reconciliation failed',
      details: fatalError.message,
    });
  }
}

module.exports = { syncEscrowsHandler };
