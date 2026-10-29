import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { createReservationHandler } from '../create.handler'
import {
  createReservation,
  TenantMismatchError,
} from '../../../services/reservation.service'
import type { CreateReservationPayload } from '@safetrust/types'

jest.mock('../../../services/reservation.service', () => {
  const actual = jest.requireActual('../../../services/reservation.service')
  return { ...actual, createReservation: jest.fn() }
})

const mockedCreateReservation = createReservation as jest.MockedFunction<
  typeof createReservation
>

const SESSION = { uid: 'guest-123', tenantId: 'safetrust', roles: ['guest'] }

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
      context: SESSION,
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
      context: SESSION,
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
      context: SESSION,
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

  it('creates reservation successfully through the service', async () => {
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

    mockedCreateReservation.mockResolvedValueOnce(mockReservation)

    const req = {
      user: { uid: 'guest-123' },
      context: SESSION,
      body: {
        apartment_id: 'apt-1',
        check_in_date: '2026-09-01',
        check_out_date: '2026-09-05',
        total_amount: 500,
        tenant_id: 'safetrust',
      },
    } as AuthenticatedRequest & { body: CreateReservationPayload }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ reservation: mockReservation })

    expect(mockedCreateReservation).toHaveBeenCalledWith({
      tenantId: 'safetrust',
      requestedTenantId: 'safetrust',
      guestId: 'guest-123',
      apartmentId: 'apt-1',
      checkInDate: '2026-09-01',
      checkOutDate: '2026-09-05',
      totalAmount: 500,
      assetCode: 'USDC',
    })
  })

  it('writes the tenant from req.context.tenantId', async () => {
    mockedCreateReservation.mockResolvedValueOnce({
      id: 'res-2',
      apartment_id: 'apt-1',
      guest_id: 'guest-123',
      status: 'pending',
      check_in_date: '2026-09-01',
      check_out_date: '2026-09-05',
      total_amount: 500,
      asset_code: 'USDC',
    })

    const req = {
      user: { uid: 'guest-123' },
      context: { ...SESSION, tenantId: 'tenant-b' },
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
    expect(mockedCreateReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-b',
        requestedTenantId: undefined,
      })
    )
  })

  it('returns 401 when the request has no session tenant', async () => {
    const req = {
      user: { uid: 'guest-123' },
      body: {
        apartment_id: 'apt-1',
        check_in_date: '2026-09-01',
        check_out_date: '2026-09-05',
        total_amount: 500,
      },
    } as AuthenticatedRequest & { body: CreateReservationPayload }
    const res = makeResponse()

    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(mockedCreateReservation).not.toHaveBeenCalled()
  })

  it('returns 403 when the body names a different tenant', async () => {
    const req = {
      user: { uid: 'guest-123' },
      context: SESSION,
      body: {
        apartment_id: 'apt-1',
        check_in_date: '2026-09-01',
        check_out_date: '2026-09-05',
        total_amount: 500,
        tenant_id: 'hotel_industry',
      },
    } as AuthenticatedRequest & { body: CreateReservationPayload }
    const res = makeResponse()

    mockedCreateReservation.mockRejectedValueOnce(new TenantMismatchError())
    await createReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: tenant mismatch' })
    expect(mockedCreateReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'safetrust',
        requestedTenantId: 'hotel_industry',
      })
    )
  })

  it('returns 500 when reservation creation fails', async () => {
    mockedCreateReservation.mockRejectedValueOnce(new Error('Reservation service failed'))

    const req = {
      user: { uid: 'guest-123' },
      context: SESSION,
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
      details: 'Reservation service failed',
    })
  })
})
