import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { createReservationHandler } from '../create.handler'
import {
  ApartmentNotFoundError,
  createReservation,
  TenantMismatchError,
} from '../../../services/reservation.service'
import type { CreateReservationPayload } from '@safetrust/types'

jest.mock('../../../services/reservation.service', () => {
  const actual = jest.requireActual('../../../services/reservation.service')
  return { ...actual, createReservation: jest.fn() }
})

const mockedCreateReservation = createReservation as jest.MockedFunction<typeof createReservation>
const session = { uid: 'guest-123', tenantId: 'safetrust', roles: ['guest'] }
const validBody = {
  apartment_id: 'apt-1',
  check_in_date: '2026-09-01',
  check_out_date: '2026-09-05',
  total_amount: 500,
}

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

describe('reservations/create.handler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when unauthorized (no user on request)', async () => {
    const req = { body: {} } as AuthenticatedRequest & { body: CreateReservationPayload }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
  })

  it('returns 400 when required fields are missing', async () => {
    const req = {
      user: { uid: 'guest-123' },
      context: session,
      body: { apartment_id: 'apt-1' },
    } as AuthenticatedRequest & { body: CreateReservationPayload }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Missing required fields: apartment_id, check_in_date, check_out_date, total_amount',
    })
  })

  it('returns 400 when check_out_date is not after check_in_date', async () => {
    const req = {
      user: { uid: 'guest-123' },
      context: session,
      body: {
        apartment_id: 'apt-1',
        check_in_date: '2026-09-10',
        check_out_date: '2026-09-05',
        total_amount: 500,
      },
    } as AuthenticatedRequest & { body: CreateReservationPayload }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: 'check_out_date must be a valid date after check_in_date',
    })
  })

  it('returns 400 when total_amount is invalid', async () => {
    const req = {
      user: { uid: 'guest-123' },
      context: session,
      body: {
        apartment_id: 'apt-1',
        check_in_date: '2026-09-01',
        check_out_date: '2026-09-05',
        total_amount: -100,
      },
    } as AuthenticatedRequest & { body: CreateReservationPayload }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: 'total_amount must be greater than zero',
    })
  })

  it('creates reservation successfully via Hasura', async () => {
    const mockReservation = {
      id: 'res-1',
      apartment_id: 'apt-1',
      guest_id: 'guest-123',
      status: 'pending',
      check_in_date: '2026-09-01',
      check_out_date: '2026-09-05',
      total_amount: 500,
      asset_code: 'USDC',
      created_at: '2026-08-24T00:00:00Z',
    }

    mockedCreateReservation.mockResolvedValueOnce(mockReservation as never)

    const req = {
      user: { uid: 'guest-123' },
      context: session,
      body: {
        apartment_id: 'apt-1',
        check_in_date: '2026-09-01',
        check_out_date: '2026-09-05',
        total_amount: 500,
      },
    } as AuthenticatedRequest & { body: CreateReservationPayload }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ reservation: mockReservation })
    expect(mockedCreateReservation).toHaveBeenCalledWith({
      tenantId: 'safetrust',
      guestId: 'guest-123',
      apartmentId: 'apt-1',
      checkInDate: '2026-09-01',
      checkOutDate: '2026-09-05',
      totalAmount: 500,
      assetCode: 'USDC',
    })
  })

  it('returns 500 when Hasura request fails', async () => {
    mockedCreateReservation.mockRejectedValueOnce(new Error('Hasura connection failed'))

    const req = {
      user: { uid: 'guest-123' },
      context: session,
      body: {
        apartment_id: 'apt-1',
        check_in_date: '2026-09-01',
        check_out_date: '2026-09-05',
        total_amount: 500,
      },
    } as AuthenticatedRequest & { body: CreateReservationPayload }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Internal server error',
      details: 'Hasura connection failed',
    })
  })

  const makeReq = () =>
    ({ user: { uid: 'guest-123' }, context: session, body: { ...validBody } }) as AuthenticatedRequest & {
      body: CreateReservationPayload
    }

  it('returns 401 when the session has no tenant context', async () => {
    const req = { user: { uid: 'guest-123' }, body: { ...validBody } } as AuthenticatedRequest & {
      body: CreateReservationPayload
    }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(mockedCreateReservation).not.toHaveBeenCalled()
  })

  it('returns 403 on a tenant mismatch', async () => {
    mockedCreateReservation.mockRejectedValueOnce(new TenantMismatchError('Tenant mismatch'))
    const res = makeResponse()

    await createReservationHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Tenant mismatch' })
  })

  it('returns 404 when the apartment does not exist', async () => {
    mockedCreateReservation.mockRejectedValueOnce(new ApartmentNotFoundError('apt-1'))
    const res = makeResponse()

    await createReservationHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns 500 when no reservation is returned', async () => {
    mockedCreateReservation.mockResolvedValueOnce(null)
    const res = makeResponse()

    await createReservationHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to create reservation' })
  })

  it('returns Hasura details when the service error carries them', async () => {
    const err = Object.assign(new Error('Hasura request failed'), { details: [{ message: 'x' }] })
    mockedCreateReservation.mockRejectedValueOnce(err)
    const res = makeResponse()

    await createReservationHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to create reservation',
      details: [{ message: 'x' }],
    })
  })
})
