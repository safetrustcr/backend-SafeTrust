import type { Reservation } from '@safetrust/types'
import { hasuraTenantRequest, TenantMismatchError } from './tenant-scoped-hasura'

export { TenantMismatchError }

export interface CreateReservationInput {
  /** Session tenant from `req.context.tenantId`, set by authMiddleware. */
  tenantId: string
  /** Tenant the client named in its payload, if any. Must equal `tenantId`. */
  requestedTenantId?: unknown
  guestId: string
  apartmentId: string
  checkInDate: string
  checkOutDate: string
  /**
   * Client quote. Stored as the booking-time price snapshot and never used for
   * billing. See the `total_amount` disposition in reservation.repository.ts.
   */
  totalAmount: number
  assetCode: string
}

const CREATE_RESERVATION_MUTATION = `
  mutation CreateReservation($object: reservations_insert_input!) {
    insert_reservations_one(object: $object) {
      id
      apartment_id
      guest_id
      status
      check_in_date
      check_out_date
      total_amount
      asset_code
      escrow_id
      created_at
    }
  }
`

/**
 * Create a pending reservation for the verified session.
 *
 * The tenant written to the row is the session tenant. A client-supplied tenant
 * that differs from it is rejected with `TenantMismatchError` before any write.
 */
export async function createReservation(
  input: CreateReservationInput
): Promise<Reservation | null> {
  const { tenantId, requestedTenantId } = input

  if (requestedTenantId !== undefined && requestedTenantId !== tenantId) {
    throw new TenantMismatchError()
  }

  console.log(
    `[reservation.service] total_amount quote recorded (not billable) — ` +
      `guestId: ${input.guestId}, apartmentId: ${input.apartmentId}, ` +
      `quote: ${input.totalAmount} ${input.assetCode}`
  )

  const data = await hasuraTenantRequest<{ insert_reservations_one: Reservation | null }>(
    tenantId,
    CREATE_RESERVATION_MUTATION,
    {
      object: {
        apartment_id: input.apartmentId,
        guest_id: input.guestId,
        check_in_date: input.checkInDate,
        check_out_date: input.checkOutDate,
        total_amount: input.totalAmount,
        asset_code: input.assetCode,
        status: 'pending',
        tenant_id: tenantId,
      },
    }
  )

  return data?.insert_reservations_one ?? null
}
