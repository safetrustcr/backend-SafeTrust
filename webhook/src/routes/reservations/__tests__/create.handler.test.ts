import { createReservationHandler } from '../create.handler'
import { hasuraRequest } from '../../../services/hasura'

jest.mock('../../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
}))

function makeResponse() {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

describe('createReservationHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 if req.user is missing', async () => {
    const req: any = { body: {} }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
  })

  it('returns 400 when required fields are missing', async () => {
    const req: any = {
      user: { uid: 'guest-123' },
      body: { apartment_id: 'apt-1' },
    }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Missing required fields: apartment_id, check_in_date, check_out_date, total_amount',
    })
  })

  it('returns 400 for invalid or check_out <= check_in dates', async () => {
    const req: any = {
      user: { uid: 'guest-123' },
      body: {
        apartment_id: 'apt-1',
        check_in_date: '2026-09-10',
        check_out_date: '2026-09-05',
        total_amount: 500,
      },
    }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: 'check_out_date must be a valid date after check_in_date',
    })
  })

  it('returns 400 for non-positive or non-numeric total_amount', async () => {
    const req: any = {
      user: { uid: 'guest-123' },
      body: {
        apartment_id: 'apt-1',
        check_in_date: '2026-09-01',
        check_out_date: '2026-09-05',
        total_amount: -50,
      },
    }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: 'total_amount must be greater than zero',
    })
  })

  it('creates reservation via Hasura successfully', async () => {
    const mockReservation = {
      id: 'res-999',
      apartment_id: 'apt-1',
      guest_id: 'guest-123',
      status: 'pending',
      check_in_date: '2026-09-01',
      check_out_date: '2026-09-05',
      total_amount: 500,
      asset_code: 'USDC',
      created_at: '2026-08-16T12:00:00Z',
    }
    ;(hasuraRequest as jest.Mock).mockResolvedValueOnce({
      insert_reservations_one: mockReservation,
    })

    const req: any = {
      user: { uid: 'guest-123' },
      body: {
        apartment_id: 'apt-1',
        check_in_date: '2026-09-01',
        check_out_date: '2026-09-05',
        total_amount: 500,
      },
    }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(hasuraRequest).toHaveBeenCalledWith(
      expect.stringContaining('mutation CreateReservation'),
      {
        object: {
          apartment_id: 'apt-1',
          guest_id: 'guest-123',
          check_in_date: '2026-09-01',
          check_out_date: '2026-09-05',
          total_amount: 500,
          asset_code: 'USDC',
          status: 'pending',
          tenant_id: 'safetrust',
        },
      }
    )
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ reservation: mockReservation })
  })

  it('returns 500 if Hasura fails to insert reservation', async () => {
    ;(hasuraRequest as jest.Mock).mockResolvedValueOnce({
      insert_reservations_one: null,
    })

    const req: any = {
      user: { uid: 'guest-123' },
      body: {
        apartment_id: 'apt-1',
        check_in_date: '2026-09-01',
        check_out_date: '2026-09-05',
        total_amount: 500,
      },
    }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to create reservation' })
  })

  it('returns 500 if Hasura throws an error with details', async () => {
    const error: any = new Error('Hasura error')
    error.details = [{ message: 'Foreign key violation' }]
    ;(hasuraRequest as jest.Mock).mockRejectedValueOnce(error)

    const req: any = {
      user: { uid: 'guest-123' },
      body: {
        apartment_id: 'apt-1',
        check_in_date: '2026-09-01',
        check_out_date: '2026-09-05',
        total_amount: 500,
      },
    }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to create reservation',
      details: [{ message: 'Foreign key violation' }],
    })
  })
})
