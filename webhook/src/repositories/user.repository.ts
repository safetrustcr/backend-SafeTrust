import type { UserRole } from '@safetrust/types'
import type { PoolClient, QueryResultRow } from 'pg'
import { query } from '../services/db'

export interface UserRow extends QueryResultRow {
  id: string
  firebase_uid: string
  email: string
  last_seen?: Date | string | null
  updated_at?: Date | string | null
}

interface UserRoleRow extends QueryResultRow {
  role: UserRole
}

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

export async function syncUser(uid: string, email: string | undefined): Promise<UserRow> {
  const updated = await query<UserRow>(RECONCILE_USER_SQL, [uid, email])
  if (updated.rows[0]) return updated.rows[0]

  let inserted: UserRow | undefined
  try {
    inserted = (await query<UserRow>(INSERT_USER_SQL, [uid, email])).rows[0]
  } catch (insertError: unknown) {
    const fallback = await query<UserRow>(
      `SELECT id, firebase_uid, email, last_seen
       FROM safetrust.users
       WHERE id = $1 OR firebase_uid = $1
       LIMIT 1`,
      [uid]
    )
    if (fallback.rows[0]) return fallback.rows[0]
    throw insertError
  }
  if (!inserted) throw new Error('User sync insert returned no row')
  return inserted
}

export async function findUserByUid(
  uid: string | undefined,
  client?: PoolClient
): Promise<{ id: string } | null> {
  const sql = 'SELECT id FROM safetrust.users WHERE id = $1 OR firebase_uid = $1 LIMIT 1'
  const result = client
    ? await client.query<{ id: string }>(sql, [uid])
    : await query<{ id: string }>(sql, [uid])
  return result.rows[0] ?? null
}

export async function listUserRoles(uid: string, ordered = false): Promise<UserRole[]> {
  const result = await query<UserRoleRow>(
    `SELECT r.name AS role
     FROM safetrust.user_roles ur
     JOIN safetrust.roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1${ordered ? ' ORDER BY r.name DESC' : ''}`,
    [uid]
  )
  return result.rows.map((row) => row.role)
}
