import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { listReservationsHandler } from '../list.handler'
import * as reservationRepo from '../../../repositories/reservation.repository'

jest.mock('../../../repositories/reservation.repository', () => ({
  findReservationsByParty: jest.fn(),
}))

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

describe('reservations/list.handler', () => {
  const mockRows: reservationRepo.ReservationRow[] = [
    {
      id: 'res-1',
      status: 'pending',
      check_in_date: new Date('2026-11-01T00:00:00.000Z'),
      check_out_date: new Date('2026-11-05T00:00:00.000Z'),
      total_amount: '300.00',
      asset_code: 'USDC',
      guest_id: 'user-1',
      escrow_id: null,
      cancelled_by: null,
      cancelled_at: null,
      cancel_reason: null,
      apartment_id: 'apt-1',
      apartment_name: 'Downtown Loft',
      owner_id: 'owner-2',
      contract_id: null,
    },
    {
      id: 'res-2',
      status: 'funded',
      check_in_date: new Date('2026-12-01T00:00:00.000Z'),
      check_out_date: new Date('2026-12-05T00:00:00.000Z'),
      total_amount: '600.00',
      asset_code: 'USDC',
      guest_id: 'guest-2',
      escrow_id: 'escrow-2',
      cancelled_by: null,
      cancelled_at: null,
      cancel_reason: null,
      apartment_id: 'apt-2',
      apartment_name: 'Beach Villa',
      owner_id: 'user-1',
      contract_id: 'contract-999',
    },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    const req = { query: {} } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await listReservationsHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
  })

  it('returns 400 for invalid role parameter', async () => {
    const req = {
      user: { uid: 'user-1' },
      query: { role: 'superadmin' },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await listReservationsHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: "Invalid role parameter. Must be 'guest', 'host' or 'both'",
    })
  })

  it('accepts role=both and queries both guest and host (parsedRole undefined)', async () => {
    ;(reservationRepo.findReservationsByParty as jest.Mock).mockResolvedValue(mockRows)

    const req = {
      user: { uid: 'user-1' },
      query: { role: 'both' },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await listReservationsHandler(req, res)

    expect(reservationRepo.findReservationsByParty).toHaveBeenCalledWith(
      'user-1',
      undefined,
      50,
      0
    )
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('returns reservations with computed allowedActions and party roles (default: both)', async () => {
    ;(reservationRepo.findReservationsByParty as jest.Mock).mockResolvedValue(mockRows)

    const req = {
      user: { uid: 'user-1' },
      query: {},
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await listReservationsHandler(req, res)

    expect(reservationRepo.findReservationsByParty).toHaveBeenCalledWith(
      'user-1',
      undefined,
      50,
      0
    )
    expect(res.status).toHaveBeenCalledWith(200)

    const responseData = (res.json as jest.Mock).mock.calls[0][0]
    expect(responseData.reservations).toHaveLength(2)

    // First reservation: user-1 is guest, status is pending, no contract
    expect(responseData.reservations[0]).toEqual({
      id: 'res-1',
      status: 'pending',
      checkIn: '2026-11-01T00:00:00.000Z',
      checkOut: '2026-11-05T00:00:00.000Z',
      amount: '300.00',
      asset: 'USDC',
      apartment: { id: 'apt-1', name: 'Downtown Loft' },
      contractId: null,
      party: 'guest',
      allowedActions: ['view', 'cancel'],
    })

    // Second reservation: user-1 is host, status is funded, has contract
    expect(responseData.reservations[1]).toEqual({
      id: 'res-2',
      status: 'funded',
      checkIn: '2026-12-01T00:00:00.000Z',
      checkOut: '2026-12-05T00:00:00.000Z',
      amount: '600.00',
      asset: 'USDC',
      apartment: { id: 'apt-2', name: 'Beach Villa' },
      contractId: 'contract-999',
      party: 'host',
      allowedActions: ['view', 'view_contract'],
    })
  })

  it('filters by role=guest when requested', async () => {
    ;(reservationRepo.findReservationsByParty as jest.Mock).mockResolvedValue([mockRows[0]])

    const req = {
      user: { uid: 'user-1' },
      query: { role: 'guest' },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await listReservationsHandler(req, res)

    expect(reservationRepo.findReservationsByParty).toHaveBeenCalledWith(
      'user-1',
      'guest',
      50,
      0
    )
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('filters by role=host when requested', async () => {
    ;(reservationRepo.findReservationsByParty as jest.Mock).mockResolvedValue([mockRows[1]])

    const req = {
      user: { uid: 'user-1' },
      query: { role: 'host' },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await listReservationsHandler(req, res)

    expect(reservationRepo.findReservationsByParty).toHaveBeenCalledWith(
      'user-1',
      'host',
      50,
      0
    )
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('respects pagination limit and offset/page', async () => {
    ;(reservationRepo.findReservationsByParty as jest.Mock).mockResolvedValue([])

    const req = {
      user: { uid: 'user-1' },
      query: { limit: '20', page: '3' },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await listReservationsHandler(req, res)

    expect(reservationRepo.findReservationsByParty).toHaveBeenCalledWith(
      'user-1',
      undefined,
      20,
      40
    )
    expect(res.status).toHaveBeenCalledWith(200)
  })
})
