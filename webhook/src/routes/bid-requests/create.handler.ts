'use strict'

import { Response } from 'express'
import { AuthenticatedRequest } from '../../middleware/auth.middleware'
import { logger } from '../../middleware/logger'
import { createBidRequest as createBid } from '../../services/bid-request.service'
import type { BidRequest } from '../../repositories/bid-request.repository'
import { ConflictError, ValidationError } from '../../utils/errors'

export type { BidRequest } from '../../repositories/bid-request.repository'

export interface CreateBidRequestPayload {
  apartmentId?: string
  apartment_id?: string
  proposedPrice?: number | string
  proposed_price?: number | string
  desiredMoveIn?: string
  desired_move_in?: string
}

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
  const apartmentId = req.body?.apartmentId || req.body?.apartment_id
  const proposedPrice = req.body?.proposedPrice || req.body?.proposed_price
  const desiredMoveIn = req.body?.desiredMoveIn || req.body?.desired_move_in

  if (apartmentId == null || proposedPrice == null || desiredMoveIn == null) {
    throw new ValidationError('Missing required fields')
  }

  const price = Number(proposedPrice)
  if (!Number.isFinite(price) || price <= 0) {
    throw new ValidationError('proposedPrice must be a positive number')
  }

  if (typeof desiredMoveIn !== 'string' || !isValidCalendarDate(desiredMoveIn)) {
    throw new ValidationError('desiredMoveIn must be a valid date')
  }

  const moveIn = new Date(desiredMoveIn)

  const result = await createBid({
    apartmentId,
    uid,
    price,
    desiredMoveIn: moveIn.toISOString(),
  })
  if (result.kind === 'duplicate') {
    throw new ConflictError('Duplicate pending bid', {
      code: 'duplicate_pending_bid',
    })
  }
  const bid = result.bid

  // bid_status_histories entry is inserted automatically by the record_bid_status trigger

  logger.info('bid_requests.create.succeeded', { bidId: bid.id })
  return res.status(201).json({ bid })
}
