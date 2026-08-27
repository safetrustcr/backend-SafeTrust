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
  const { uid, email } = req.user

  try {
    const result = await query<RoleRow>(
      `SELECT r.name
       FROM public.user_roles ur
       JOIN public.roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1`,
      [uid]
    )

    const roles = result.rows.map((row) => row.name)
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