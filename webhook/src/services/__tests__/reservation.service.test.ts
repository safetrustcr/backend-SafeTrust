import { createReservation, TenantMismatchError } from '../reservation.service'
import { hasuraRequest } from '../hasura'

jest.mock('../hasura', () => ({
  hasuraRequest: jest.fn(),
}))

const mockedHasuraRequest = hasuraRequest as jest.MockedFunction<typeof hasuraRequest>

function input(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'safetrust',
    guestId: 'guest-123',
    apartmentId: 'apt-1',
    checkInDate: '2026-09-01',
    checkOutDate: '2026-09-05',
    totalAmount: 500,
    assetCode: 'USDC',
    ...overrides,
  }
}

describe('reservation.service createReservation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('writes the session tenant into the insert payload', async () => {
    mockedHasuraRequest.mockResolvedValueOnce({
      insert_safetrust_reservations_one: {
        id: 'res-1',
        apartmentId: 'apt-1',
        guestId: 'guest-123',
        status: 'pending',
        checkInDate: '2026-09-01',
        checkOutDate: '2026-09-05',
        totalAmount: 500,
        assetCode: 'USDC',
        escrowId: null,
        tenantId: 'tenant-a',
      },
    })

    const result = await createReservation(input({ tenantId: 'tenant-a' }))

    expect(result).toEqual(
      expect.objectContaining({
        id: 'res-1',
        apartment_id: 'apt-1',
        tenant_id: 'tenant-a',
      })
    )
    const [, variables] = mockedHasuraRequest.mock.calls[0]
    expect(variables).toEqual({
      object: expect.objectContaining({
        tenantId: 'tenant-a',
        guestId: 'guest-123',
        status: 'pending',
      }),
    })
  })

  it('accepts a client tenant that matches the session tenant', async () => {
    mockedHasuraRequest.mockResolvedValueOnce({
      insert_safetrust_reservations_one: null,
    })

    await createReservation(input({ requestedTenantId: 'safetrust' }))

    expect(mockedHasuraRequest).toHaveBeenCalledTimes(1)
  })

  it('rejects a mismatched tenant at the service layer without writing', async () => {
    await expect(
      createReservation(input({ tenantId: 'safetrust', requestedTenantId: 'hotel_industry' }))
    ).rejects.toBeInstanceOf(TenantMismatchError)

    expect(mockedHasuraRequest).not.toHaveBeenCalled()
  })

  it('rejects a missing session tenant without writing', async () => {
    await expect(createReservation(input({ tenantId: '' }))).rejects.toBeInstanceOf(
      TenantMismatchError
    )

    expect(mockedHasuraRequest).not.toHaveBeenCalled()
  })

  it('logs total_amount as a non-billable quote', async () => {
    mockedHasuraRequest.mockResolvedValueOnce({
      insert_safetrust_reservations_one: null,
    })

    await createReservation(input())

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('quote: 500 USDC'))
  })
})
