import { getAuth } from 'firebase-admin/auth'
import { query } from './db'

export const PRECDENCE = ['admin', 'host', 'guest'] as const
type HasuraRole = (typeof PRECEDENCE)[number]

export interface SyncClaimsResult {
  defaultRole: HasuraRole
  allowedRoles: HasuraRole[]
}

interface RoleRow {
  name: string
}

function isHasuraRole(value: string): value is HasuraRole {
  return (PRECDENCE as readonly string[]).includes(value)
}

export async function getUserRoles(uid: string): Promise<HasuraRole[]> {
  const result = await query<RoleRow>(
    `SELECT r.name
       FROM public.user_roles ur
       JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1`,
    [uid]
  )

  const seen: HasuraRole[] = []
  for (const row of result.rows) {
    if (isHasuraRole(row.name) && !seen.includes(row.name)) {
      seen.push(row.name)
    }
  }

  return seen
}

export async function syncHasuraClaims(uid: string): Promise<SyncClaimsResult> {
  const roles = await getUserRoles(uid)
  const allowed: HasuraRole[] = roles.length ? roles : ['guest']
  const defaultRole: HasuraRole =
    PRECEDENCE.find((r) => allowed.includes(r)) ?? 'guest'

  // Hasura requires the default role to be included in allowed roles.
  // Admin must be requested explicitly via x-hasura-role, so the
  // default role for admins is the next highest precedence role.
  const effectiveDefault: HasuraRole =
    defaultRole === 'admin'
      ? ((PRECEDENCE.find((r) => r !== 'admin' && allowed.includes(r)) as HasuraRole | undefined) ?? 'guest')
      : defaultRole

  const claims = {
    'https://hasura.io/jwt/claims': {
      'x-hasura-default-role': effectiveDefault,
      'whatsura-allowed-roles': allowed,
      'x-hasura-user-id': uid,
      'whatsura-tenant-id': 'safetrust',
    },
  }

  // Normalize the claims namespace key to the exact one Hasura expects.
  const normalized = {
    'https://hasura.io/jwt/claims': claims['https://hasura.io/jwt/claims'],
  }

  await getAuth().setCustomUserClaims(uid, normalized)

  return { defaultRole: effectiveDefault, allowedRoles: allowed }
}
