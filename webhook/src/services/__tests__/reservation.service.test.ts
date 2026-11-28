import { createReservation, TenantMismatchError } from '../reservation.service'
import { query } from '../../db/pool'

jest.mock('../../db/pool', () => ({
  query: jest.fn(),
}))

const mockedQuery = query as jest.MockedFunction<typeof query>

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
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'res-1',
          apartment_id: 'apt-1',
          guest_id: 'guest-123',
          status: 'pending',
          check_in_date: '2026-09-01',
          check_out_date: '2026-09-05',
          total_amount: 500,
          asset_code: 'USDC',
          escrow_id: null,
          tenant_id: 'tenant-a',
        },
      ],
      rowCount: 1,
    } as any)

    const result = await createReservation(input({ tenantId: 'tenant-a' }))

    expect(result).toEqual(
      expect.objectContaining({
        id: 'res-1',
        apartment_id: 'apt-1',
        tenant_id: 'tenant-a',
      })
    )
    const [sql, params] = mockedQuery.mock.calls[0]
    expect(sql).toContain('INSERT INTO safetrust.reservations')
    expect(params).toEqual([
      'tenant-a',
      'apt-1',
      'guest-123',
      '2026-09-01',
      '2026-09-05',
      500,
      'USDC',
    ])
  })

  it('accepts a client tenant that matches the session tenant', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

    await createReservation(input({ requestedTenantId: 'safetrust' }))

    expect(mockedQuery).toHaveBeenCalledTimes(1)
  })

  it('rejects a mismatched tenant at the service layer without writing', async () => {
    await expect(
      createReservation(input({ tenantId: 'safetrust', requestedTenantId: 'hotel_industry' }))
    ).rejects.toBeInstanceOf(TenantMismatchError)

    expect(mockedQuery).not.toHaveBeenCalled()
  })

  it('rejects a missing session tenant without writing', async () => {
    await expect(createReservation(input({ tenantId: '' }))).rejects.toBeInstanceOf(
      TenantMismatchError
    )

    expect(mockedQuery).not.toHaveBeenCalled()
  })

  it('logs total_amount as a non-billable quote', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

    await createReservation(input())

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('quote: 500 USDC'))
  })
})
