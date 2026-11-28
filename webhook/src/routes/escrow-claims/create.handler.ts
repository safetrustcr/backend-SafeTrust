'use strict'

import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { EscrowClaimRow } from '../../repositories/escrow-claims.repository'
import { createEscrowClaim } from '../../services/escrow-claims.service'
import { UUID_PATTERN } from './validation'
import { logger } from '../../middleware/logger'
import {
  AppError,
  AuthError,
  ConflictError,
  NotFoundError,
  TooManyRequestsError,
  ValidationError,
} from '../../utils/errors'

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
    throw new ValidationError('INVALID_CLAIM_REQUEST', { code: 'invalid_claim_request' })
  }

  const text = typeof body === 'string' ? body.trim() : ''
  const length = Array.from(text).length
  if (length < MIN_BODY || length > MAX_BODY) {
    throw new ValidationError('INVALID_CLAIM_BODY', { code: 'invalid_claim_body' })
  }

  const uid = req.user?.uid
  if (!uid) {
    throw new AuthError('UNAUTHORIZED', { code: 'unauthorized' })
  }

  const result = await createEscrowClaim({
    escrowId,
    authorId: uid,
    body: text,
    clientOpId,
  })
  if (result.kind === 'not-participant') {
    throw new NotFoundError('ESCROW_NOT_FOUND', { code: 'escrow_not_found' })
  }
  if (result.kind === 'already-used') {
    if (result.claim.escrow_id !== escrowId) {
      throw new ConflictError('CLIENT_OP_ID_REUSED', { code: 'client_op_id_reused' })
    }
    return res.status(200).json(toResponse(result.claim))
  }
  if (result.kind === 'not-released') {
    throw new ConflictError('ESCROW_NOT_RELEASED', { code: 'escrow_not_released' })
  }
  if (result.kind === 'rate-limited') {
    res.set('Retry-After', RETRY_AFTER_SECONDS)
    throw new TooManyRequestsError('CLAIM_RATE_LIMITED', {
      code: 'claim_rate_limited',
      headers: { 'Retry-After': RETRY_AFTER_SECONDS },
    })
  }
  if (result.kind === 'conflict-without-row') {
    logger.error('escrow_claims.create.missing_after_conflict')
    throw new AppError('INTERNAL_ERROR', 500)
  }
  return res.status(201).json(toResponse(result.claim))
}
