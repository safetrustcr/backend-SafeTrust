'use strict'

import { Request, Response, NextFunction } from 'express'
import { getAuth, DecodedIdToken } from 'firebase-admin/auth'
import { query } from '../services/db'

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * The user attached to the request by `authMiddleware`. Extends the Firebase
 * `DecodedIdToken` with the role fields resolved from `safetrust.user_roles`.
 */
export interface AuthenticatedUser extends DecodedIdToken {
  roles: string[]
  role: string
  admin?: boolean
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser
}

interface RoleRow {
  name: string
}

/**
 * Resolves the roles assigned to a user from the `safetrust.user_roles` join table.
 *
 * Mirrors the query convention in `routes/auth/me.handler.js`: a user may hold
 * multiple roles, so `roles` is always an array. `role` is a convenience scalar
 * holding the highest-privilege assigned role (or `'guest'` when none are
 * assigned), used for single-role response shapes.
 *
 * The query orders by an explicit privilege precedence so `roles[0]` — and any
 * response derived from it — is deterministic. Without `ORDER BY`, PostgreSQL
 * does not guarantee row order, which would make the scalar `role` (and the
 * sync-user response) flap for multi-role users. Authorization decisions must
 * still consider the full `roles` array, not just this scalar.
 */
async function resolveUserRole(uid: string): Promise<{ roles: string[]; role: string }> {
  const result = await query<RoleRow>(
    `SELECT r.name
     FROM safetrust.user_roles ur
     JOIN safetrust.roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1
     ORDER BY
       CASE r.name
         WHEN 'admin' THEN 0
         WHEN 'host'  THEN 1
         WHEN 'guest' THEN 2
         ELSE 3
       END,
       r.name`,
    [uid]
  )

  const roles = result.rows.map((row) => row.name)
  return { roles, role: roles[0] ?? 'guest' }
}

/**
 * Verifies a Firebase Bearer token and attaches `uid`, `email`, `name`, `role`,
 * `roles`, and `admin` to `req.user`. Roles are sourced from `safetrust.user_roles`
 * (not Firebase custom claims) in both the test-bypass and verified-token paths.
 */
export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers['authorization']

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or malformed Authorization header',
    })
    return
  }

  const token = authHeader.split('Bearer ')[1]

  // Bypass for testing
  if (token === 'mock-token') {
    if (process.env.NODE_ENV !== 'test') {
      console.error('FATAL: mock-token used outside of test environment')
      res.status(500).json({
        error: 'Server configuration error',
        message: 'mock-token not allowed in this environment'
      })
      return
    }
    const uid = (req.headers['x-test-uid'] as string) || 'test-user-id'
    const { roles, role } = await resolveUserRole(uid)
    req.user = {
      uid,
      email: req.headers['x-test-email'] || 'test@example.com',
      roles,
      role,
    } as unknown as AuthenticatedUser
    next()
    return
  }

  try {
    const decoded = await getAuth().verifyIdToken(token)
    const { roles, role } = await resolveUserRole(decoded.uid)
    req.user = {
      ...decoded, // Include all custom claims
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      admin: decoded.admin === true,
      roles, // role/roles from user_roles win over any custom claims
      role,
    }
    next()
  } catch (error) {
    console.error('[auth] Token verification failed:', (error as Error).message)
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    })
  }
}

export const authenticateFirebase = authMiddleware

export { resolveUserRole }
