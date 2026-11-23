import { pool } from './db'
import { logger } from '../middleware/logger'
import { findUserByUid } from '../repositories/user.repository'
import {
  BidRequest,
  createBidRequest as insertBidRequest,
  findBidForUpdate,
  hasActiveBid,
  updateBidStatus,
} from '../repositories/bid-request.repository'

export const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['APPROVED', 'CANCELLED'],
  APPROVED: ['CONFIRMED', 'CANCELLED'],
}

export type UpdateBidResult =
  | { kind: 'profile-missing' }
  | { kind: 'not-found' }
  | { kind: 'not-owner' }
  | { kind: 'invalid-transition'; allowedTransitions: string[] }
  | { kind: 'updated'; bid: BidRequest | undefined }

export type CreateBidResult =
  | { kind: 'duplicate' }
  | { kind: 'created'; bid: BidRequest }

export async function createBidRequest(input: {
  apartmentId: string
  uid: string | undefined
  price: number
  desiredMoveIn: string
}): Promise<CreateBidResult> {
  if (await hasActiveBid(input.uid)) return { kind: 'duplicate' }

  try {
    const bid = await insertBidRequest(input)
    return { kind: 'created', bid }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Tenant already has an active bid')) {
      return { kind: 'duplicate' }
    }
    throw error
  }
}

export async function updateBidRequest(
  uid: string | undefined,
  id: string,
  status: string
): Promise<UpdateBidResult> {
  const client = await pool.connect()
  let transactionOpen = false
  try {
    await client.query('BEGIN')
    transactionOpen = true

    if (!await findUserByUid(uid, client)) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return { kind: 'profile-missing' }
    }

    const bid = await findBidForUpdate(client, id)
    if (!bid) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return { kind: 'not-found' }
    }

    if (bid.owner_id !== uid) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return { kind: 'not-owner' }
    }

    const allowed = VALID_TRANSITIONS[bid.current_status] ?? []
    if (!allowed.includes(status)) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return { kind: 'invalid-transition', allowedTransitions: allowed }
    }

    const updated = await updateBidStatus(client, id, status, uid)
    await client.query('COMMIT')
    transactionOpen = false
    return { kind: 'updated', bid: updated }
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        logger.error('bid_requests.update.rollback_failed', { error: rollbackError })
      }
    }
    throw error
  } finally {
    client.release()
  }
}
