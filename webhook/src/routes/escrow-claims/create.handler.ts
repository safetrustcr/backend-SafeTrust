'use strict'

import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { EscrowClaimRow } from '../../repositories/escrow-claims.repository'
import { createEscrowClaim } from '../../services/escrow-claims.service'
import { UUID_PATTERN } from './validation'
import { logger } from '../../middleware/logger'

const MIN_BODY = 10
const MAX_BODY = 2000
const RETRY_AFTER_SECONDS = '86400'

const toResponse = (row: EscrowClaimRow) => ({
  id: row.id,
  status: row.status,
  createdAt: row.created_at,
})

/**
 * POST /api/escrow-claims/:escrowId: a participant of a released escrow files a claim.
 * Idempotent per (author, clientOpId); at most 5 claims per author per escrow per 24h.
 */
export const createClaimHandler = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  const { escrowId } = req.params as { escrowId: string }
  const { body, clientOpId } = (req.body || {}) as { body?: unknown; clientOpId?: unknown }

  if (
    !UUID_PATTERN.test(escrowId ?? '') ||
    typeof clientOpId !== 'string' ||
    !UUID_PATTERN.test(clientOpId)
  ) {
    return res.status(400).json({ error: 'INVALID_CLAIM_REQUEST' })
  }

  const text = typeof body === 'string' ? body.trim() : ''
  const length = Array.from(text).length
  if (length < MIN_BODY || length > MAX_BODY) {
    return res.status(400).json({ error: 'INVALID_CLAIM_BODY' })
  }

  const uid = req.user?.uid
  if (!uid) {
    return res.status(401).json({ error: 'UNAUTHORIZED' })
  }

  try {
    const result = await createEscrowClaim({
      escrowId,
      authorId: uid,
      body: text,
      clientOpId,
    })
    if (result.kind === 'not-participant') {
      return res.status(404).json({ error: 'ESCROW_NOT_FOUND' })
    }
    if (result.kind === 'already-used') {
      if (result.claim.escrow_id !== escrowId) {
        return res.status(409).json({ error: 'CLIENT_OP_ID_REUSED' })
      }
      return res.status(200).json(toResponse(result.claim))
    }
    if (result.kind === 'not-released') {
      return res.status(409).json({ error: 'ESCROW_NOT_RELEASED' })
    }
    if (result.kind === 'rate-limited') {
      res.set('Retry-After', RETRY_AFTER_SECONDS)
      return res.status(429).json({ error: 'CLAIM_RATE_LIMITED' })
    }
    if (result.kind === 'conflict-without-row') {
      logger.error('escrow_claims.create.missing_after_conflict')
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
    return res.status(201).json(toResponse(result.claim))
  } catch (err) {
    logger.error('escrow_claims.create.failed', { error: err })
    return res.status(500).json({ error: 'INTERNAL_ERROR' })
  }
}
