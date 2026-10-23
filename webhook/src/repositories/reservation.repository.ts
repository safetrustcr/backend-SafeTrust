import { hasuraAdminRequest } from '../services/hasura'
import { query } from '../services/db'
import { PoolClient } from 'pg'

/**
 * DISPOSITION: `reservation.total_amount` is a NON-BINDING QUOTE.
 *
 * The value originates from the client payload at reservation creation and is
 * persisted as a display/estimate figure only. It is NOT trusted for billing,
 * escrow funding, or any financial settlement. Any billable total MUST be
 * derived server-side from pricing and availability at the point of charge
 * (see escrow/pricing services), never echoed from the browser.
 *
 * This repository reads `total_amount` for display purposes only. Do not use
 * it to compute charges, refunds, or escrow amounts.
 */

export interface ReservationRow {
  id: string
  status: string
  check_in_date: Date | string
  check_out_date: Date | string
  total_amount: string | number
  asset_code: string
  guest_id: string
  escrow_id: string | null
  cancelled_by?: string | null
  cancelled_at?: Date | string | null
  cancel_reason?: string | null
  apartment_id: string
  apartment_name: string
  owner_id: string
  contract_id: string | null
}

export async function linkEscrowToReservation(
  reservationId: string,
  escrowId: string,
  tenantId: string
): Promise<void> {
  if (!tenantId) {
    throw new Error('linkEscrowToReservation: tenantId is required')
  }

  // Tenant-scoped update: the reservation is only linked when it belongs to
  // the same tenant as the verified caller / escrow record.
  const mutation = `
    mutation LinkEscrowToReservation($reservationId: uuid!, $escrowId: uuid!, $tenantId: String!) {
      update_reservations: update_safetrust_reservations(
        where: {
          id: { _eq: $reservationId }
          tenantId: { _eq: $tenantId }
        }
        _set: {
          escrowId: $escrowId,
          status: "escrow_created",
          updatedAt: "now()"
        }
      ) {
        returning { id status escrowId }
      }
    }
  `

  await hasuraAdminRequest(tenantId, mutation, {
    reservationId,
    escrowId,
    tenantId,
  })
}

export async function mirrorReservationStatus(
  escrowId: string,
  status: string,
  tenantId: string
): Promise<void> {
  if (!tenantId) {
    throw new Error('mirrorReservationStatus: tenantId is required')
  }

  const mutation = `
    mutation MirrorStatusToReservation($escrowId: uuid!, $status: String!, $tenantId: String!) {
      update_reservations: update_safetrust_reservations(
        where: {
          escrowId: { _eq: $escrowId }
          tenantId: { _eq: $tenantId }
        }
        _set: {
          status: $status
          updatedAt: "now()"
        }
      ) {
        returning { id status }
      }
    }
  `

  await hasuraAdminRequest(tenantId, mutation, { escrowId, status, tenantId })
}

export async function mirrorReservationStatusInTransaction(
  client: PoolClient,
  escrowId: string,
  status: string
): Promise<void> {
  await client.query(
    `UPDATE safetrust.reservations
     SET status = $1, updated_at = NOW()
     WHERE escrow_id = $2
       AND tenant_id = (
         SELECT e.tenant_id FROM safetrust.trustless_work_escrows e WHERE e.id = $2
       )`,
    [status, escrowId]
  )
}

export async function findReservationsByParty(
  userId: string,
  role?: 'guest' | 'host',
  limit: number = 50,
  offset: number = 0
): Promise<ReservationRow[]> {
  let whereClause = '(r.guest_id = $1 OR a.owner_id = $1)'
  if (role === 'guest') {
    whereClause = 'r.guest_id = $1'
  } else if (role === 'host') {
    whereClause = 'a.owner_id = $1'
  }

  const sql = `
    SELECT
      r.id,
      r.status,
      r.check_in_date,
      r.check_out_date,
      r.total_amount,
      r.asset_code,
      r.guest_id,
      r.escrow_id,
      r.cancelled_by,
      r.cancelled_at,
      r.cancel_reason,
      a.id AS apartment_id,
      a.name AS apartment_name,
      a.owner_id,
      e.contract_id
    FROM safetrust.reservations r
    JOIN safetrust.apartments a ON a.id = r.apartment_id
    LEFT JOIN safetrust.trustless_work_escrows e ON e.id = r.escrow_id
    WHERE ${whereClause}
    ORDER BY r.check_in_date DESC, r.id DESC
    LIMIT $2 OFFSET $3
  `

  const result = await query<ReservationRow>(sql, [userId, limit, offset])
  return result.rows
}

export async function findReservationById(
  id: string
): Promise<ReservationRow | null> {
  const sql = `
    SELECT
      r.id,
      r.status,
      r.check_in_date,
      r.check_out_date,
      r.total_amount,
      r.asset_code,
      r.guest_id,
      r.escrow_id,
      r.cancelled_by,
      r.cancelled_at,
      r.cancel_reason,
      a.id AS apartment_id,
      a.name AS apartment_name,
      a.owner_id,
      e.contract_id
    FROM safetrust.reservations r
    JOIN safetrust.apartments a ON a.id = r.apartment_id
    LEFT JOIN safetrust.trustless_work_escrows e ON e.id = r.escrow_id
    WHERE r.id = $1
  `

  const result = await query<ReservationRow>(sql, [id])
  return result.rows[0] ?? null
}

export async function updateReservationCancellation(
  id: string,
  userId: string,
  reason?: string | null
): Promise<boolean> {
  const sql = `
    UPDATE safetrust.reservations r
    SET
      status = 'cancelled',
      updated_at = NOW(),
      cancelled_by = $2,
      cancelled_at = NOW(),
      cancel_reason = $3
    FROM safetrust.apartments a
    WHERE r.id = $1
      AND a.id = r.apartment_id
      AND (r.guest_id = $2 OR a.owner_id = $2)
      AND r.status IN ('pending', 'escrow_created')
    RETURNING r.id
  `

  const result = await query<{ id: string }>(sql, [id, userId, reason ?? null])
  return (result.rowCount ?? 0) > 0
}
