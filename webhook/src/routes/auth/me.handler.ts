import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import type { MeResponse, UserRole } from '../../domain'
import { logger } from '../../middleware/logger'
import { listUserRoles } from '../../repositories/user.repository'

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
      roles = await listUserRoles(uid)
    }

    const isHost = roles.some((role) => ['host', 'admin'].includes(role))
    const response: MeResponse = {
      user: { id: uid, email: email ?? '', roles },
      redirect: isHost ? '/dashboard/escrow-dashboard' : '/dashboard/guest',
    }

    return res.status(200).json(response)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('auth.me.failed', { error: message })
    return res.status(500).json({ error: 'Failed to resolve user roles' })
  }
}