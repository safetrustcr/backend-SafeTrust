import { createReservation } from '../reservation.repository'
import { hasuraRequest } from '../../services/hasura'

const runIntegrationTest = process.env.HASURA_INTEGRATION_TEST === 'true' ? it : it.skip

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required when HASURA_INTEGRATION_TEST=true`)
  }
  return value
}

describe('reservation.repository Hasura integration', () => {
  runIntegrationTest('inserts a reservation and returns the created record shape', async () => {
    const apartmentId = requiredEnv('HASURA_TEST_APARTMENT_ID')
    const guestId = requiredEnv('HASURA_TEST_GUEST_ID')
    const checkInDate = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000)
    const checkOutDate = new Date(checkInDate)
    checkOutDate.setUTCHours(checkOutDate.getUTCHours() + 1)
    let reservationId: string | undefined
    try {
      const reservation = await createReservation({
        tenantId: 'safetrust',
        apartmentId,
        guestId,
        checkInDate: checkInDate.toISOString(),
        checkOutDate: checkOutDate.toISOString(),
        totalAmount: 1,
        assetCode: 'USDC',
      })

      reservationId = reservation?.id

      expect(reservation).toMatchObject({
        id: expect.any(String),
        apartment_id: apartmentId,
        guest_id: guestId,
        status: 'pending',
        check_in_date: checkInDate.toISOString(),
        check_out_date: checkOutDate.toISOString(),
        total_amount: 1,
        asset_code: 'USDC',
        tenant_id: 'safetrust',
      })
    } finally {
      if (reservationId) {
        await hasuraRequest(
          `
            mutation DeleteTestReservation($id: uuid!) {
              delete_safetrust_reservations_by_pk(id: $id) {
                id
              }
            }
          `,
          { id: reservationId }
        )
      }
    }
  })
})
