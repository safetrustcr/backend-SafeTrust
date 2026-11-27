import { Request, Response } from 'express'
import { logger } from '../../middleware/logger'
import { syncClaims } from '../../services/claims'
import { ValidationError } from '../../utils/errors'

interface HasuraUserRolesEvent {
  event?: {
    op?: string
    data?: {
      new?: { user_id?: unknown }
      old?: { user_id?: unknown }
    }
  }
}

export const syncClaimsEventHandler = async (req: Request, res: Response): Promise<Response> => {
  const body = req.body as HasuraUserRolesEvent
  const row = body?.event?.op === 'DELETE' ? body.event.data?.old : body?.event?.data?.new
  const uid = typeof row?.user_id === 'string' ? row.user_id.trim() : ''
  if (!uid) {
    throw new ValidationError('Missing user_id in user_roles event')
  }

  const claimsUpdated = await syncClaims(uid)
  logger.info('auth.hasura_claims_synced', { uid, claimsUpdated })
  return res.status(200).json({ claimsUpdated })
}
