import type { PoolClient, QueryResultRow } from 'pg'
import { query } from '../services/db'

export interface BidRequest extends QueryResultRow {
  id: string
  apartment_id: string
  bidder_id: string
  proposed_price: number | string
  desired_move_in: string
  current_status: string
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
}

export interface BidRequestWithOwner extends BidRequest {
  owner_id: string
}

const EXISTING_ACTIVE = `
  SELECT id FROM safetrust.bid_requests
  WHERE bidder_id = $1
    AND current_status IN ('PENDING', 'VIEWED', 'APPROVED')
    AND deleted_at IS NULL
  LIMIT 1
`

const INSERT_BID = `
  INSERT INTO safetrust.bid_requests
    (apartment_id, bidder_id, proposed_price, desired_move_in, current_status)
  VALUES ($1, $2, $3, $4, 'PENDING')
  RETURNING *
`

const GET_BID = `
  SELECT br.*, a.owner_id
  FROM safetrust.bid_requests br
  JOIN safetrust.apartments a ON br.apartment_id = a.id
  WHERE br.id = $1 AND br.deleted_at IS NULL
  FOR UPDATE OF br
`

const UPDATE_BID = `
  UPDATE safetrust.bid_requests
  SET current_status = $1, updated_at = NOW()
  WHERE id = $2
  RETURNING *
`

const INSERT_HISTORY = `
  INSERT INTO safetrust.bid_status_histories
    (bid_request_id, status, changed_by)
  VALUES ($1, $2, $3)
`

export async function hasActiveBid(uid: string | undefined): Promise<boolean> {
  const result = await query<{ id: string }>(EXISTING_ACTIVE, [uid])
  return result.rows.length > 0
}

export async function createBidRequest(input: {
  apartmentId: string
  uid: string | undefined
  price: number
  desiredMoveIn: string
}): Promise<BidRequest> {
  const result = await query<BidRequest>(INSERT_BID, [
    input.apartmentId,
    input.uid,
    input.price,
    input.desiredMoveIn,
  ])
  return result.rows[0]
}

export async function findBidForUpdate(
  client: PoolClient,
  id: string
): Promise<BidRequestWithOwner | null> {
  const result = await client.query<BidRequestWithOwner>(GET_BID, [id])
  return result.rows[0] ?? null
}

export async function updateBidStatus(
  client: PoolClient,
  id: string,
  status: string,
  uid: string | undefined
): Promise<BidRequest | undefined> {
  const updated = await client.query<BidRequest>(UPDATE_BID, [status, id])
  await client.query(INSERT_HISTORY, [id, status, uid])
  return updated.rows[0]
}
