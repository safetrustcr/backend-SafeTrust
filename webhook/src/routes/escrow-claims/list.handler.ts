'use strict'

import { Response } from 'express'
import { pool } from '../../services/db'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { findParticipation, listForEscrow } from '../../repositories/escrow-claims.repository'
import { UUID_PATTERN } from './validation'

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

  const client = await pool.connect()
  try {
    const participation = await findParticipation(client, escrowId, uid)
    if (!participation) {
      return res.status(404).json({ error: 'ESCROW_NOT_FOUND' })
    }

    const rows = await listForEscrow(escrowId, client)
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
    console.error('listClaimsHandler error:', err)
    return res.status(500).json({ error: 'INTERNAL_ERROR' })
  } finally {
    client.release()
  }
}
