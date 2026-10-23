import { Response } from 'express'
import { query } from '../../services/db'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import type { MeResponse, UserRole } from '@safetrust/types'

interface RoleRow {
  name: UserRole
}

export const meHandler = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const uid = req.context?.uid || req.user?.uid
  const email = req.context?.email || req.user?.email

  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    // Read roles from centralized request context; fall back to DB lookup if missing
    let roles: UserRole[] = (req.context?.roles || req.user?.roles) as UserRole[]

    if (!roles || roles.length === 0) {
      const result = await query<RoleRow>(
        `SELECT r.name
         FROM safetrust.user_roles ur
         JOIN safetrust.roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1`,
        [uid]
      )
      roles = result.rows.map((row) => row.name)
    }

    const isHost = roles.some((role) => ['host', 'admin'].includes(role))
    const response: MeResponse = {
      user: { id: uid, email: email ?? '', roles },
      redirect: isHost ? '/dashboard/escrow-dashboard' : '/dashboard/guest',
    }

    return res.status(200).json(response)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[auth/me] error:', message)
    return res.status(500).json({ error: 'Failed to resolve user roles' })
  }
}