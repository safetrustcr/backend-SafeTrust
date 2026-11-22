import type { Reservation } from '@safetrust/types'
import {
  createReservation as createReservationRecord,
  type CreateReservationRecordInput,
} from '../repositories/reservation.repository'
import { logger } from '../middleware/logger'
import { TenantMismatchError } from './tenant-scoped-hasura'

export { TenantMismatchError }

export interface CreateReservationInput extends CreateReservationRecordInput {
  /** Tenant the client named in its payload, if any. Must equal `tenantId`. */
  requestedTenantId?: unknown
}

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

  logger.info('reservation.quote.recorded', {
    guestId: input.guestId,
    apartmentId: input.apartmentId,
    amount: input.totalAmount,
    assetCode: input.assetCode,
    billable: false,
  })

  return createReservationRecord(input)
}
