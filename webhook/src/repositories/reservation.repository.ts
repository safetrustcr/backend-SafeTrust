import { hasuraTenantRequest } from '../services/tenant-scoped-hasura'
import { query } from '../services/db'
import { PoolClient } from 'pg'
import type { Reservation } from '@safetrust/types'

/**
 * `reservation.total_amount` disposition: NON-BINDING QUOTE.
 *
 * The value comes from the client at reservation creation and is stored as the
 * booking-time price snapshot (see the column comment in the create_reservations
 * migration). It is logged by `reservation.service` and returned for display.
 * Nothing in this service bills, funds, refunds or settles from it: the amount
 * held and released on-chain is the escrow `amount` on trustless_work_escrows,
 * which Trustless Work reports through the signed escrow webhooks.
 *
 * If `total_amount` ever drives a charge, it must first be derived server-side
 * from apartment pricing and availability before the insert, replacing the
 * client value.
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

export interface CreateReservationRecordInput {
  /** Verified session tenant written to the reservation. */
  tenantId: string
  guestId: string
  apartmentId: string
  checkInDate: string
  checkOutDate: string
  totalAmount: number
  assetCode: string
}

const CREATE_RESERVATION_MUTATION = `
  mutation CreateReservation($object: safetrust_reservations_insert_input!) {
    insert_safetrust_reservations_one(object: $object) {
      id
      apartmentId
      guestId
      status
      checkInDate
      checkOutDate
      totalAmount
      assetCode
      escrowId
      createdAt
      tenantId
    }
  }
`

export async function createReservation(
  input: CreateReservationRecordInput
): Promise<Reservation | null> {
  const data = await hasuraTenantRequest<{
    insert_safetrust_reservations_one: {
      id: string
      apartmentId: string
      guestId: string
      status: string
      checkInDate: string
      checkOutDate: string
      totalAmount: number
      assetCode: string
      escrowId: string | null
      createdAt?: string
      tenantId: string
    } | null
  }>(input.tenantId, CREATE_RESERVATION_MUTATION, {
    object: {
      tenantId: input.tenantId,
      apartmentId: input.apartmentId,
      guestId: input.guestId,
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
      totalAmount: input.totalAmount,
      assetCode: input.assetCode,
      status: 'pending',
    },
  })

  const reservation = data?.insert_safetrust_reservations_one
  if (!reservation) return null

  return {
    id: reservation.id,
    apartment_id: reservation.apartmentId,
    guest_id: reservation.guestId,
    status: reservation.status,
    check_in_date: reservation.checkInDate,
    check_out_date: reservation.checkOutDate,
    total_amount: reservation.totalAmount,
    asset_code: reservation.assetCode,
    escrow_id: reservation.escrowId,
    created_at: reservation.createdAt,
    tenant_id: reservation.tenantId,
  }
}

/**
 * Return the tenant that owns `reservationId`, or null when no such
 * reservation exists. Read-only lookup used to resolve the tenant before an
 * escrow is written for the reservation.
 */
export async function findReservationTenantId(
  reservationId: string
): Promise<string | null> {
  const result = await query<{ tenant_id: string }>(
    'SELECT tenant_id FROM safetrust.reservations WHERE id = $1',
    [reservationId]
  )
  return result.rows[0]?.tenant_id ?? null
}

export async function linkEscrowToReservation(
  reservationId: string,
  escrowId: string,
  tenantId: string
): Promise<void> {
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
        affected_rows
      }
    }
  `

  const data = await hasuraTenantRequest<{
    update_reservations?: { affected_rows: number }
  }>(tenantId, mutation, {
    reservationId,
    escrowId,
    tenantId,
  })

  // No row means the reservation is missing or belongs to another tenant.
  // Throw so the caller leaves the webhook event unprocessed for a retry.
  if (!data?.update_reservations?.affected_rows) {
    throw new Error(
      `Reservation ${reservationId} was not linked: no matching reservation for tenant ${tenantId}`
    )
  }
}

export type TransactionClient = PoolClient | { query: (text: string, params?: unknown[]) => Promise<unknown> }

export async function mirrorReservationStatus(
  escrowId: string,
  status: string,
  tenantId: string,
  client?: TransactionClient
): Promise<void> {
  if (client) {
    await client.query(
      `
        UPDATE safetrust.reservations
        SET
          status = $1,
          updated_at = NOW()
        WHERE escrow_id = $2
          AND tenant_id = $3
      `,
      [status, escrowId, tenantId]
    )
    return
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

  await hasuraTenantRequest(tenantId, mutation, { escrowId, status, tenantId })
}

export async function mirrorReservationStatusInTransaction(
  client: PoolClient,
  escrowId: string,
  status: string,
  tenantId: string
): Promise<void> {
  await client.query(
    `UPDATE safetrust.reservations
     SET status = $1, updated_at = NOW()
     WHERE escrow_id = $2 AND tenant_id = $3`,
    [status, escrowId, tenantId]
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
