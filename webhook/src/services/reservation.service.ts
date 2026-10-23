import type { Reservation } from '@safetrust/types'
import { hasuraAdminRequest, TenantMismatchError } from './hasura'
import { query } from './db'

export { TenantMismatchError }

export class ApartmentNotFoundError extends Error {
  constructor(apartmentId: string) {
    super(`Apartment not found: ${apartmentId}`)
    this.name = 'ApartmentNotFoundError'
  }
}

export interface CreateReservationInput {
  /** Tenant from the verified session (`req.context.tenantId`). */
  tenantId: string
  guestId: string
  apartmentId: string
  checkInDate: string
  checkOutDate: string
  /** Non-binding quote; see reservation.repository for the disposition. */
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
 * Create a reservation on behalf of the verified session.
 *
 * The admin Hasura client is only reached through this service: the tenant
 * comes from the verified session (never a literal or a raw header), the
 * apartment must exist, and `hasuraAdminRequest` re-checks the insert payload
 * tenant against the session before the privileged write.
 */
export async function createReservation(
  input: CreateReservationInput
): Promise<Reservation | null> {
  const { tenantId } = input
  if (!tenantId) {
    throw new TenantMismatchError('A verified session tenant is required')
  }

  const apartment = await query<{ id: string }>(
    'SELECT id FROM safetrust.apartments WHERE id = $1',
    [input.apartmentId]
  )
  if (!apartment.rows[0]) {
    throw new ApartmentNotFoundError(input.apartmentId)
  }

  const data = await hasuraAdminRequest<{ insert_reservations_one: Reservation | null }>(
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
