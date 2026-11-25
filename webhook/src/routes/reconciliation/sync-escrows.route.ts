'use strict'

/**
 * @file src/routes/reconciliation/sync-escrows.route.ts
 * @description Express router for POST /reconciliation/sync-escrows.
 *
 * This route is intentionally NOT protected by Firebase auth because it is
 * called by the Hasura cron trigger (server-to-server). The Hasura trigger
 * supplies a shared secret via the `x-hasura-event-secret` header which is
 * validated here to prevent unauthorised calls.
 *
 * If HASURA_EVENT_SECRET is not set in the environment, any caller can invoke
 * the endpoint — but only in non-production. The webhook refuses to start
 * with NODE_ENV=production when the secret is missing (see
 * requireHasuraEventSecret in services/hasura.ts, called from server.ts),
 * so a production deployment can never serve this endpoint unauthenticated.
 * Local development sets the secret in webhook/.env.example / .env.
 */

import { Router, Request, Response, NextFunction, RequestHandler } from 'express'
import { syncEscrowsHandler } from './sync-escrows.handler'
import { logger } from '../../middleware/logger'

const router = Router()

// ─── Shared-secret guard for Hasura cron trigger ───────────────────────────
/**
 * Validates the `x-hasura-event-secret` header when HASURA_EVENT_SECRET is
 * set. Returns 401 if the secret does not match.
 */
export function hasuraSecretGuard(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.HASURA_EVENT_SECRET
  if (!secret) {
    // No secret configured → open (dev mode)
    return next()
  }

  const provided = req.headers['x-hasura-event-secret']
  if (!provided || provided !== secret) {
    logger.warn('reconciliation.event_secret_rejected')
    res.status(401).json({ error: 'Unauthorized: invalid event secret' })
    return
  }
  return next()
}

/**
 * @route  POST /reconciliation/sync-escrows
 * @desc   Triggered by Hasura cron job every 15 minutes.
 *         Fetches all contract_ids → calls TrustlessWork indexer in batches
 *         of 50 → upserts changed rows → returns sync summary.
 * @access Server-to-server (Hasura cron trigger)
 */
router.post('/sync-escrows', hasuraSecretGuard, syncEscrowsHandler as unknown as RequestHandler)

export default router
