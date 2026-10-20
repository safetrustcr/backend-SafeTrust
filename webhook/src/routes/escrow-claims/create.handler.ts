'use strict'

import { Response } from 'express'
import { pool } from '../../services/db'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import {
  CLAIM_RATE_LIMIT,
  EscrowClaimRow,
  countRecent,
  findByOpId,
  findParticipation,
  insert,
} from '../../repositories/escrow-claims.repository'
import { UUID_PATTERN } from './validation'

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

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))", [uid, escrowId])

    const participation = await findParticipation(client, escrowId, uid, true)
    if (!participation) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'ESCROW_NOT_FOUND' })
    }

    const existing = await findByOpId(client, uid, clientOpId)
    if (existing) {
      await client.query('ROLLBACK')
      if (existing.escrow_id !== escrowId) {
        return res.status(409).json({ error: 'CLIENT_OP_ID_REUSED' })
      }
      return res.status(200).json(toResponse(existing))
    }

    if (participation.status !== 'completed') {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'ESCROW_NOT_RELEASED' })
    }

    if ((await countRecent(client, uid, escrowId)) >= CLAIM_RATE_LIMIT) {
      await client.query('ROLLBACK')
      res.set('Retry-After', RETRY_AFTER_SECONDS)
      return res.status(429).json({ error: 'CLAIM_RATE_LIMITED' })
    }

    const created = await insert(client, {
      escrowId,
      reservationId: participation.reservationId,
      authorId: uid,
      body: text,
      clientOpId,
    })
    if (!created) {
      const raced = await findByOpId(client, uid, clientOpId)
      await client.query('ROLLBACK')
      if (raced && raced.escrow_id === escrowId) {
        return res.status(200).json(toResponse(raced))
      }
      if (raced) {
        return res.status(409).json({ error: 'CLIENT_OP_ID_REUSED' })
      }
      console.error('createClaimHandler: claim missing after insert conflict')
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }

    await client.query('COMMIT')
    return res.status(201).json(toResponse(created))
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // connection already unusable; release below discards it
    }
    console.error('createClaimHandler error:', err)
    return res.status(500).json({ error: 'INTERNAL_ERROR' })
  } finally {
    client.release()
  }
}
