import { Response } from 'express'
import { hasuraRequest } from '../../services/hasura'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import type { UserRole, MeResponse } from '@safetrust/types'

export const meHandler = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const uid   = req.user.uid
  const email = req.user.email ?? ''

  try {
    const data = await hasuraRequest<{
      user_roles: Array<{ role: { name: UserRole } }>
    }>(
      `query GetUserRoles($uid: String!) {
        user_roles(where: { user_id: { _eq: $uid } }) {
          role { name }
        }
      }`,
      { uid }
    )

    const roles = (data?.user_roles ?? []).map(ur => ur.role.name)
    const isHost = roles.some(r => (['host', 'admin'] as UserRole[]).includes(r))

    const response: MeResponse = {
      user: { id: uid, email, roles },
      redirect: isHost ? '/dashboard/escrow-dashboard' : '/dashboard/guest',
    }

    return res.status(200).json(response)

  } catch (error) {
    const err = error as Error
    console.error('[auth/me] ❌ error:', err.message)
    return res.status(500).json({ error: 'Failed to resolve user roles' })
  }
}
