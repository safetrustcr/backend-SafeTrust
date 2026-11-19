import type { PoolClient } from 'pg'
import { pool } from '../services/db'

export interface EscrowClaimRow {
  id: string
  escrow_id: string
  reservation_id: string | null
  author_id: string
  body: string
  status: string
  client_op_id: string
  created_at: Date | string
  updated_at: Date | string
}

export interface Participation {
  reservationId: string
  status: string
}

export interface NewEscrowClaim {
  escrowId: string
  reservationId: string
  authorId: string
  body: string
  clientOpId: string
}

export const CLAIM_RATE_LIMIT = 5

const PARTICIPATION_SELECT = `
  SELECT r.id AS reservation_id, r.status
  FROM safetrust.reservations r
  JOIN safetrust.apartments a ON a.id = r.apartment_id
  WHERE r.escrow_id = $1 AND (r.guest_id = $2 OR a.owner_id = $2)
`
const FIND_PARTICIPATION = PARTICIPATION_SELECT
const FIND_PARTICIPATION_LOCKED = `${PARTICIPATION_SELECT}  FOR SHARE OF r
`

const FIND_BY_OP_ID = `
  SELECT * FROM safetrust.escrow_claims
  WHERE author_id = $1 AND client_op_id = $2
`

const COUNT_RECENT = `
  SELECT count(*) AS count FROM safetrust.escrow_claims
  WHERE author_id = $1 AND escrow_id = $2
    AND created_at > NOW() - INTERVAL '24 hours'
`

const INSERT_CLAIM = `
  INSERT INTO safetrust.escrow_claims
    (escrow_id, reservation_id, author_id, body, client_op_id)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (author_id, client_op_id) DO NOTHING
  RETURNING *
`

const LIST_FOR_ESCROW = `
  SELECT id, author_id, body, status, created_at, updated_at
  FROM safetrust.escrow_claims
  WHERE escrow_id = $1
  ORDER BY created_at DESC
`

export async function findParticipation(
  client: PoolClient,
  escrowId: string,
  uid: string,
  lock = false
): Promise<Participation | null> {
  const result = await client.query<{ reservation_id: string; status: string }>(
    lock ? FIND_PARTICIPATION_LOCKED : FIND_PARTICIPATION,
    [escrowId, uid]
  )
  const row = result.rows[0]
  return row ? { reservationId: row.reservation_id, status: row.status } : null
}

export async function findByOpId(
  client: PoolClient,
  authorId: string,
  clientOpId: string
): Promise<EscrowClaimRow | null> {
  const result = await client.query<EscrowClaimRow>(FIND_BY_OP_ID, [authorId, clientOpId])
  return result.rows[0] ?? null
}

export async function countRecent(
  client: PoolClient,
  authorId: string,
  escrowId: string
): Promise<number> {
  const result = await client.query<{ count: string }>(COUNT_RECENT, [authorId, escrowId])
  return Number(result.rows[0]?.count ?? 0)
}

export async function insert(
  client: PoolClient,
  row: NewEscrowClaim
): Promise<EscrowClaimRow | null> {
  const result = await client.query<EscrowClaimRow>(INSERT_CLAIM, [
    row.escrowId,
    row.reservationId,
    row.authorId,
    row.body,
    row.clientOpId,
  ])
  return result.rows[0] ?? null
}

export async function listForEscrow(
  escrowId: string,
  client?: PoolClient
): Promise<Omit<EscrowClaimRow, 'escrow_id' | 'reservation_id' | 'client_op_id'>[]> {
  const runner = client ?? pool
  const result = await runner.query(LIST_FOR_ESCROW, [escrowId])
  return result.rows
}
