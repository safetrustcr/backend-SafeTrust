import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import db from '../../services/db'

let cachedUsersIdDataType: string | undefined

async function getUsersIdColumnType(): Promise<string | undefined> {
  if (cachedUsersIdDataType) {
    return cachedUsersIdDataType
  }

  const result = await db.query<{ data_type: string }>(
    `SELECT data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'id'`
  )

  cachedUsersIdDataType = result.rows[0]?.data_type
  return cachedUsersIdDataType
}

interface SyncedUserRow {
  id: string
  firebase_uid: string
  email: string
  last_seen?: Date | string
  updated_at?: Date | string
}

export const syncUserHandler = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const { uid, email } = req.user

  try {
    const idColumnType = await getUsersIdColumnType()
    let queryStr: string
    let values: unknown[]

    if (idColumnType === 'uuid') {
      // hotel_industry: UUID surrogate key; firebase_uid is the auth identifier
      queryStr = `
        INSERT INTO public.users (firebase_uid, email)
        VALUES ($1, $2)
        ON CONFLICT (firebase_uid) WHERE firebase_uid IS NOT NULL
        DO UPDATE SET email = EXCLUDED.email, updated_at = NOW()
        RETURNING id, firebase_uid, email, updated_at
      `
      values = [uid, email]
    } else {
      // safetrust: Firebase UID stored as primary key (TEXT)
      queryStr = `
        INSERT INTO public.users (id, firebase_uid, email, last_seen)
        VALUES ($1, $1, $2, NOW())
        ON CONFLICT (id)
        DO UPDATE SET last_seen = NOW(), email = EXCLUDED.email, firebase_uid = EXCLUDED.firebase_uid
        RETURNING id, firebase_uid, email, last_seen
      `
      values = [uid, email]
    }

    const result = await db.query<SyncedUserRow>(queryStr, values)
    const user = result.rows[0]

    console.log(`[sync-user] ✅ user synced — uid: ${user.firebase_uid}`)

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        role: req.user.role,
        last_seen: user.last_seen ?? user.updated_at,
      },
    })
  } catch (error) {
    const err = error as Error
    console.error('[sync-user] ❌ error:', err.message)
    return res.status(500).json({ error: 'Database error' })
  }
}
