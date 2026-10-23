import {
  ApartmentNotFoundError,
  createReservation,
  TenantMismatchError,
} from '../reservation.service'
import { query } from '../db'

// The real hasuraAdminRequest tenant guard runs; only the network (fetch) is mocked.

jest.mock('../db', () => ({
  query: jest.fn(),
}))

const mockedQuery = query as jest.MockedFunction<typeof query>
const mockedFetch = jest.fn()

const baseInput = {
  tenantId: 'tenant-a',
  guestId: 'guest-1',
  apartmentId: 'apt-1',
  checkInDate: '2026-02-01',
  checkOutDate: '2026-02-05',
  totalAmount: 123.45,
  assetCode: 'USDC',
}

const insertedRow = {
  id: 'res-1',
  apartment_id: 'apt-1',
  guest_id: 'guest-1',
  status: 'pending',
  check_in_date: '2026-02-01',
  check_out_date: '2026-02-05',
  total_amount: 123.45,
  asset_code: 'USDC',
  escrow_id: null,
  created_at: '2026-01-01T00:00:00Z',
}

function respond(data: unknown) {
  mockedFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data }) })
}

describe('reservation.service', () => {
  const originalFetch = global.fetch
  const originalSecret = process.env.HASURA_ADMIN_SECRET

  beforeAll(() => {
    global.fetch = mockedFetch as unknown as typeof fetch
    process.env.HASURA_ADMIN_SECRET = 'test-secret'
  })

  afterAll(() => {
    global.fetch = originalFetch
    if (originalSecret === undefined) delete process.env.HASURA_ADMIN_SECRET
    else process.env.HASURA_ADMIN_SECRET = originalSecret
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('createReservation', () => {
    it('rejects when the session tenant is missing', async () => {
      await expect(createReservation({ ...baseInput, tenantId: '' })).rejects.toBeInstanceOf(
        TenantMismatchError
      )
      expect(mockedQuery).not.toHaveBeenCalled()
      expect(mockedFetch).not.toHaveBeenCalled()
    })

    it('rejects when the apartment does not exist', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)

      await expect(createReservation(baseInput)).rejects.toBeInstanceOf(ApartmentNotFoundError)
      expect(mockedFetch).not.toHaveBeenCalled()
    })

    it('persists the reservation with tenant derived from the session', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'apt-1' }], rowCount: 1 } as never)
      respond({ insert_reservations_one: insertedRow })

      const result = await createReservation(baseInput)

      expect(mockedFetch).toHaveBeenCalledTimes(1)
      const body = JSON.parse(mockedFetch.mock.calls[0][1].body)
      expect(body.variables.object.tenant_id).toBe('tenant-a')
      expect(body.variables.object.total_amount).toBe(123.45)
      expect(body.variables.object.status).toBe('pending')
      expect(result?.id).toBe('res-1')
    })

    it('returns null when the insert returns no row', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'apt-1' }], rowCount: 1 } as never)
      respond({ insert_reservations_one: null })

      await expect(createReservation(baseInput)).resolves.toBeNull()
    })
  })
})
