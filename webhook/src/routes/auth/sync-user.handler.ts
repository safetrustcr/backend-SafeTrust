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
 * Compatibility Policy:
 * Identity mapping decision: SafeTrust maps Firebase UID directly to `safetrust.users.id` (TEXT PRIMARY KEY)
 * and `safetrust.users.firebase_uid` (TEXT) as defined in migration 1731908676359_create_users and
 * 1779300000001_migrate_to_safetrust_schema. All supported deployments (development, staging, production)
 * use TEXT primary key identifiers matching Firebase UIDs.
 * The legacy UUID column type check against information_schema was confirmed dead code across all active
 * environments and was removed in favor of this direct, deterministic upsert.
 */
const SYNC_USER_SQL = `
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
    const result = await query<UserRow>(SYNC_USER_SQL, [uid, email])
    const user = result.rows[0]

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