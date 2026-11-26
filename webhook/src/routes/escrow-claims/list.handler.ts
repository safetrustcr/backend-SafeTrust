'use strict'

import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { listForParticipant } from '../../repositories/escrow-claims.repository'
import { UUID_PATTERN } from './validation'
import { logger } from '../../middleware/logger'

/**
 * GET /api/escrow-claims/:escrowId: both parties of the escrow see all its claims.
 */
export const listClaimsHandler = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const { escrowId } = req.params as { escrowId: string }
  if (!UUID_PATTERN.test(escrowId ?? '')) {
    return res.status(400).json({ error: 'INVALID_CLAIM_REQUEST' })
  }

  const uid = req.user?.uid
  if (!uid) {
    return res.status(401).json({ error: 'UNAUTHORIZED' })
  }

  try {
    const rows = await listForParticipant(escrowId, uid)
    if (!rows) {
      return res.status(404).json({ error: 'ESCROW_NOT_FOUND' })
    }

    return res.status(200).json({
      claims: rows.map((row) => ({
        id: row.id,
        authorId: row.author_id,
        body: row.body,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    })
  } catch (err) {
    logger.error('escrow_claims.list.failed', { error: err })
    return res.status(500).json({ error: 'INTERNAL_ERROR' })
  }
}
