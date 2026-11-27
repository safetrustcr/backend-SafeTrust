'use strict'

import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { listForParticipant } from '../../repositories/escrow-claims.repository'
import { UUID_PATTERN } from './validation'
import { AuthError, NotFoundError, ValidationError } from '../../utils/errors'

/**
 * GET /api/escrow-claims/:escrowId: both parties of the escrow see all its claims.
 */
export const listClaimsHandler = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const { escrowId } = req.params as { escrowId: string }
  if (!UUID_PATTERN.test(escrowId ?? '')) {
    throw new ValidationError('INVALID_CLAIM_REQUEST', { code: 'invalid_claim_request' })
  }

  const uid = req.user?.uid
  if (!uid) {
    throw new AuthError('UNAUTHORIZED', { code: 'unauthorized' })
  }

  const rows = await listForParticipant(escrowId, uid)
  if (!rows) {
    throw new NotFoundError('ESCROW_NOT_FOUND', { code: 'escrow_not_found' })
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
}
