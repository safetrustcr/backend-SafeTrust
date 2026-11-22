'use strict'

import { Response } from 'express'
import { query } from '../../services/db'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { logger } from '../../middleware/logger'
import type { CreateBidRequestBody } from '../../validation'

export type CreateBidRequestPayload = CreateBidRequestBody

export interface BidRequest {
  id: string
  apartment_id: string
  tenant_id: string
  proposed_price: number | string
  desired_move_in: string
  current_status: string
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
}

// Mirrors the check_active_bids trigger: one active bid per tenant across all apartments
const EXISTING_ACTIVE = `
  SELECT id FROM safetrust.bid_requests
  WHERE tenant_id = $1
    AND current_status IN ('PENDING', 'VIEWED', 'APPROVED')
    AND deleted_at IS NULL
  LIMIT 1
`

const INSERT_BID = `
  INSERT INTO safetrust.bid_requests
    (apartment_id, tenant_id, proposed_price, desired_move_in, current_status)
  VALUES ($1, $2, $3, $4, 'PENDING')
  RETURNING *
`

/**
 * Validates that a date string is a valid calendar date without silent overflow normalization
 * (e.g. rejecting non-existent dates like 2026-02-30 or 2026-04-31).
 *
 * @param dateStr - The date string to validate
 * @returns True if dateStr represents a valid calendar date, false otherwise
 */
export function isValidCalendarDate(dateStr: string): boolean {
  if (typeof dateStr !== 'string' || !dateStr.trim()) return false
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return false

  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) {
    const year = parseInt(match[1], 10)
    const month = parseInt(match[2], 10)
    const day = parseInt(match[3], 10)
    if (month < 1 || month > 12) return false
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    if (day < 1 || day > daysInMonth) return false
  }
  return true
}

/**
 * Handles creation of a new bid request by an authenticated tenant.
 *
 * @param req - Authenticated request containing tenant info and bid payload
 * @param res - Express response
 * @returns JSON response with created bid or error details
 */
export const createBidRequestHandler = async (
  req: AuthenticatedRequest & { body: CreateBidRequestPayload },
  res: Response
): Promise<Response> => {
  const uid = req.context?.uid || req.user?.uid
  const apartmentId = req.body.apartmentId ?? req.body.apartment_id!
  const proposedPrice = req.body.proposedPrice ?? req.body.proposed_price!
  const desiredMoveIn = req.body.desiredMoveIn ?? req.body.desired_move_in!

  const price = Number(proposedPrice)

  const moveIn = new Date(desiredMoveIn)

  try {
    const existing = await query<{ id: string }>(EXISTING_ACTIVE, [uid])
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Duplicate pending bid',
      })
    }

    const result = await query<BidRequest>(INSERT_BID, [
      apartmentId,
      uid,
      price,
      moveIn.toISOString(),
    ])
    const bid = result.rows[0]

    // bid_status_histories entry is inserted automatically by the record_bid_status trigger

    logger.info('bid_requests.create.succeeded', { bidId: bid.id })
    return res.status(201).json({ bid })
  } catch (error) {
    const err = error as Error
    // The check_active_bids trigger raises this on concurrent duplicate inserts
    if (err.message && err.message.includes('Tenant already has an active bid')) {
      return res.status(409).json({
        error: 'Duplicate pending bid',
      })
    }
    logger.error('bid_requests.create.failed', { error: err })
    return res.status(500).json({ error: 'Failed to create bid request' })
  }
}
