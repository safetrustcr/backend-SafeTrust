import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { logger } from '../../middleware/logger'
import { syncUser } from '../../repositories/user.repository'
import { syncClaims } from '../../services/claims'
import { AuthError } from '../../utils/errors'

/**
 * Compatibility & Reconciliation Policy:
 * Identity mapping decision: SafeTrust maps Firebase UID directly to `safetrust.users.id` (TEXT PRIMARY KEY)
 * and `safetrust.users.firebase_uid` (TEXT) as defined in migration 1731908676359_create_users and
 * 1779300000001_migrate_to_safetrust_schema. All supported deployments (development, staging, production)
 * use TEXT primary key identifiers matching Firebase UIDs.
 *
 * To safely reconcile any existing rows where `id` may differ from the Firebase UID (e.g. historical seeds
 * or legacy deployments with a separate unique index on `firebase_uid`), we first attempt to reconcile/update
 * by `id = $1 OR firebase_uid = $1`. If no matching row exists, we insert a new user with `id = firebase_uid = $1`.
 * This preserves the `firebase_uid` conflict path and avoids duplicate key constraint violations (HTTP 500).
 */
export const syncUserHandler = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const uid = req.context?.uid || req.user?.uid
  const email = req.context?.email || req.user?.email
  const role =
    req.user?.role ||
    (req.context?.roles?.includes('admin')
      ? 'admin'
      : req.context?.roles?.includes('host')
      ? 'host'
      : 'guest')

  if (!uid) {
    throw new AuthError('Unauthorized')
  }

  const user = await syncUser(uid, email)
  const claimsUpdated = await syncClaims(uid)

  logger.info('auth.sync_user.succeeded', { uid: user.firebase_uid, claimsUpdated })
  return res.status(200).json({
    claimsUpdated,
    user: {
      id: user.id,
      email: user.email,
      role,
      last_seen: user.last_seen ?? user.updated_at,
    },
  })
}