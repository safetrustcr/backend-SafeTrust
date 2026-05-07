'use strict';

/**
 * @file src/routes/reconciliation/sync-escrows.route.js
 * @description Express router for POST /reconciliation/sync-escrows.
 *
 * This route is intentionally NOT protected by Firebase auth because it is
 * called by the Hasura cron trigger (server-to-server). The Hasura trigger
 * supplies a shared secret via the `x-hasura-event-secret` header which is
 * validated here to prevent unauthorised calls.
 *
 * If HASURA_EVENT_SECRET is not set in the environment, any caller can invoke
 * the endpoint — this is acceptable in development but MUST be configured in
 * production.
 */

const express = require('express');
const { syncEscrowsHandler } = require('./sync-escrows.handler');

const router = express.Router();

// ─── Optional: shared-secret guard for Hasura cron trigger ───────────────────
/**
 * Validates the `x-hasura-event-secret` header when HASURA_EVENT_SECRET is
 * set.  Returns 401 if the secret does not match.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function hasuraSecretGuard(req, res, next) {
  const secret = process.env.HASURA_EVENT_SECRET;
  if (!secret) {
    // No secret configured → open (dev mode)
    return next();
  }

  const provided = req.headers['x-hasura-event-secret'];
  if (!provided || provided !== secret) {
    console.warn('[reconciliation] ⛔ Invalid or missing x-hasura-event-secret');
    return res.status(401).json({ error: 'Unauthorized: invalid event secret' });
  }
  return next();
}

/**
 * @route  POST /reconciliation/sync-escrows
 * @desc   Triggered by Hasura cron job every 15 minutes.
 *         Fetches all contract_ids → calls TrustlessWork indexer in batches
 *         of 50 → upserts changed rows → returns sync summary.
 * @access Server-to-server (Hasura cron trigger)
 */
router.post('/sync-escrows', hasuraSecretGuard, syncEscrowsHandler);

module.exports = router;
