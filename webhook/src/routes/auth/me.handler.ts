import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import type { MeResponse, UserRole } from '@safetrust/types'
import { listUserRoles } from '../../repositories/user.repository'
import { AuthError } from '../../utils/errors'

export const meHandler = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const uid = req.context?.uid || req.user?.uid
  const email = req.context?.email || req.user?.email

  if (!uid) {
    throw new AuthError('Unauthorized')
  }

  // Read roles from centralized request context; fall back to DB lookup if missing
  let roles: UserRole[] = (req.context?.roles || req.user?.roles) as UserRole[]

  if (!roles || roles.length === 0) {
    roles = await listUserRoles(uid)
  }

  const isHost = roles.some((role) => ['host', 'admin'].includes(role))
  const response: MeResponse = {
    user: { id: uid, email: email ?? '', roles },
    redirect: isHost ? '/dashboard/escrow-dashboard' : '/dashboard/guest',
  }

  return res.status(200).json(response)
}