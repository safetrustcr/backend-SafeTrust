import { Response } from 'express'
import { query } from '../../services/db'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'

interface UserRow {
  id: string
  firebase_uid: string
  email: string
  last_seen?: Date | string | null
  updated_at?: Date | string | null
}

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
const RECONCILE_USER_SQL = `
  UPDATE safetrust.users
  SET last_seen = NOW(), email = $2, firebase_uid = $1
  WHERE id = $1 OR firebase_uid = $1
  RETURNING id, firebase_uid, email, last_seen
`

const INSERT_USER_SQL = `
  INSERT INTO safetrust.users (id, firebase_uid, email, last_seen)
  VALUES ($1, $1, $2, NOW())
  ON CONFLICT (id)
  DO UPDATE SET last_seen = NOW(), email = EXCLUDED.email, firebase_uid = EXCLUDED.firebase_uid
  RETURNING id, firebase_uid, email, last_seen
`

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
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    // 1. Reconcile/update existing row matching either id or firebase_uid
    const updateResult = await query<UserRow>(RECONCILE_USER_SQL, [uid, email])
    let user = updateResult.rows[0]

    // 2. If no existing row found, insert new record
    if (!user) {
      try {
        const insertResult = await query<UserRow>(INSERT_USER_SQL, [uid, email])
        user = insertResult.rows[0]
      } catch (insertError: unknown) {
        // Fallback for concurrent insert or unique constraint collision on firebase_uid
        const fallback = await query<UserRow>(
          `SELECT id, firebase_uid, email, last_seen
           FROM safetrust.users
           WHERE id = $1 OR firebase_uid = $1
           LIMIT 1`,
          [uid]
        )
        if (fallback.rows[0]) {
          user = fallback.rows[0]
        } else {
          throw insertError
        }
      }
    }

    console.log(`[sync-user] user synced - uid: ${user.firebase_uid}`)
    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        role,
        last_seen: user.last_seen ?? user.updated_at,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[sync-user] error:', message)
    return res.status(500).json({ error: 'Database error' })
  }
}