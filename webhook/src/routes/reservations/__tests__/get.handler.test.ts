import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { getReservationHandler } from '../get.handler'
import * as reservationRepo from '../../../repositories/reservation.repository'

jest.mock('../../../repositories/reservation.repository', () => ({
  findReservationById: jest.fn(),
}))

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

describe('reservations/get.handler', () => {
  const mockReservation: reservationRepo.ReservationRow = {
    id: 'res-100',
    status: 'escrow_created',
    check_in_date: new Date('2026-10-10T14:00:00.000Z'),
    check_out_date: new Date('2026-10-15T10:00:00.000Z'),
    total_amount: '550.50',
    asset_code: 'USDC',
    guest_id: 'guest-1',
    escrow_id: 'escrow-1',
    cancelled_by: null,
    cancelled_at: null,
    cancel_reason: null,
    apartment_id: 'apt-5',
    apartment_name: 'Skyline Penthouse',
    owner_id: 'owner-1',
    contract_id: 'contract-555',
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    const req = {
      params: { id: 'res-100' },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await getReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
  })

  it('returns 404 when reservation is not found', async () => {
    ;(reservationRepo.findReservationById as jest.Mock).mockResolvedValue(null)

    const req = {
      user: { uid: 'guest-1' },
      params: { id: 'res-nonexistent' },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await getReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Reservation not found' })
  })

  it('returns 404 for a stranger (neither guest nor apartment owner)', async () => {
    ;(reservationRepo.findReservationById as jest.Mock).mockResolvedValue(mockReservation)

    const req = {
      user: { uid: 'stranger-99' },
      params: { id: 'res-100' },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await getReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Reservation not found' })
  })

  it('returns reservation DTO when caller is the guest', async () => {
    ;(reservationRepo.findReservationById as jest.Mock).mockResolvedValue(mockReservation)

    const req = {
      user: { uid: 'guest-1' },
      params: { id: 'res-100' },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await getReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      id: 'res-100',
      status: 'escrow_created',
      checkIn: '2026-10-10T14:00:00.000Z',
      checkOut: '2026-10-15T10:00:00.000Z',
      amount: '550.50',
      asset: 'USDC',
      apartment: { id: 'apt-5', name: 'Skyline Penthouse' },
      contractId: 'contract-555',
      party: 'guest',
      allowedActions: ['view', 'view_contract', 'cancel'],
    })
  })

  it('returns reservation DTO when caller is the apartment owner', async () => {
    ;(reservationRepo.findReservationById as jest.Mock).mockResolvedValue(mockReservation)

    const req = {
      user: { uid: 'owner-1' },
      params: { id: 'res-100' },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await getReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      id: 'res-100',
      status: 'escrow_created',
      checkIn: '2026-10-10T14:00:00.000Z',
      checkOut: '2026-10-15T10:00:00.000Z',
      amount: '550.50',
      asset: 'USDC',
      apartment: { id: 'apt-5', name: 'Skyline Penthouse' },
      contractId: 'contract-555',
      party: 'host',
      allowedActions: ['view', 'view_contract', 'cancel'],
    })
  })
})
