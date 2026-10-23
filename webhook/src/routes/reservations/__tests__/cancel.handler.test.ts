import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { cancelReservationHandler } from '../cancel.handler'
import * as reservationRepo from '../../../repositories/reservation.repository'

jest.mock('../../../repositories/reservation.repository', () => ({
  findReservationById: jest.fn(),
  updateReservationCancellation: jest.fn(),
}))

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

describe('reservations/cancel.handler', () => {
  const mockReservation: reservationRepo.ReservationRow = {
    id: 'res-123',
    status: 'pending',
    check_in_date: new Date('2026-10-01T00:00:00.000Z'),
    check_out_date: new Date('2026-10-05T00:00:00.000Z'),
    total_amount: '450.00',
    asset_code: 'USDC',
    guest_id: 'guest-1',
    escrow_id: null,
    cancelled_by: null,
    cancelled_at: null,
    cancel_reason: null,
    apartment_id: 'apt-1',
    apartment_name: 'Sunset Suite',
    owner_id: 'owner-1',
    contract_id: null,
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when user is not authenticated', async () => {
    const req = {
      params: { id: 'res-123' },
      body: {},
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await cancelReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
  })

  it('returns 400 when reason is not a string', async () => {
    const req = {
      user: { uid: 'guest-1' },
      params: { id: 'res-123' },
      body: { reason: 12345 },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await cancelReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Reason must be a string' })
  })

  it('returns 400 when reason exceeds 500 characters', async () => {
    const req = {
      user: { uid: 'guest-1' },
      params: { id: 'res-123' },
      body: { reason: 'a'.repeat(501) },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await cancelReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Cancellation reason must be 500 characters or less',
    })
  })

  it('returns 404 when reservation does not exist', async () => {
    ;(reservationRepo.findReservationById as jest.Mock).mockResolvedValue(null)

    const req = {
      user: { uid: 'guest-1' },
      params: { id: 'res-missing' },
      body: {},
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await cancelReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Reservation not found' })
  })

  it('returns 404 when caller is a stranger (neither guest nor apartment owner)', async () => {
    ;(reservationRepo.findReservationById as jest.Mock).mockResolvedValue(mockReservation)

    const req = {
      user: { uid: 'stranger-user' },
      params: { id: 'res-123' },
      body: {},
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await cancelReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Reservation not found' })
    expect(reservationRepo.updateReservationCancellation).not.toHaveBeenCalled()
  })

  it('cancels successfully when caller is the guest (pending status)', async () => {
    ;(reservationRepo.findReservationById as jest.Mock)
      .mockResolvedValueOnce(mockReservation)
      .mockResolvedValueOnce({
        ...mockReservation,
        status: 'cancelled',
        cancelled_by: 'guest-1',
        cancelled_at: new Date('2026-10-20T12:00:00.000Z'),
        cancel_reason: 'Plans changed',
      })
    ;(reservationRepo.updateReservationCancellation as jest.Mock).mockResolvedValue(true)

    const req = {
      user: { uid: 'guest-1' },
      params: { id: 'res-123' },
      body: { reason: 'Plans changed' },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await cancelReservationHandler(req, res)

    expect(reservationRepo.updateReservationCancellation).toHaveBeenCalledWith(
      'res-123',
      'guest-1',
      'Plans changed'
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'res-123',
        status: 'cancelled',
        party: 'guest',
        amount: '450.00',
        allowedActions: ['view'],
      })
    )
  })

  it('cancels successfully when caller is the apartment owner (escrow_created status)', async () => {
    const escrowCreatedReservation: reservationRepo.ReservationRow = {
      ...mockReservation,
      status: 'escrow_created',
      escrow_id: 'escrow-1',
      contract_id: 'contract-abc',
    }

    ;(reservationRepo.findReservationById as jest.Mock)
      .mockResolvedValueOnce(escrowCreatedReservation)
      .mockResolvedValueOnce({
        ...escrowCreatedReservation,
        status: 'cancelled',
        cancelled_by: 'owner-1',
        cancelled_at: new Date('2026-10-20T12:00:00.000Z'),
        cancel_reason: 'Maintenance issue',
      })
    ;(reservationRepo.updateReservationCancellation as jest.Mock).mockResolvedValue(true)

    const req = {
      user: { uid: 'owner-1' },
      params: { id: 'res-123' },
      body: { reason: 'Maintenance issue' },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await cancelReservationHandler(req, res)

    expect(reservationRepo.updateReservationCancellation).toHaveBeenCalledWith(
      'res-123',
      'owner-1',
      'Maintenance issue'
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'res-123',
        status: 'cancelled',
        party: 'host',
        contractId: 'contract-abc',
        allowedActions: ['view', 'view_contract'],
      })
    )
  })

  it('is idempotent on double cancel (returns 200 + DTO without re-updating)', async () => {
    const alreadyCancelled: reservationRepo.ReservationRow = {
      ...mockReservation,
      status: 'cancelled',
      cancelled_by: 'guest-1',
      cancelled_at: new Date('2026-10-20T12:00:00.000Z'),
      cancel_reason: 'First cancel reason',
    }

    ;(reservationRepo.findReservationById as jest.Mock).mockResolvedValue(alreadyCancelled)

    const req = {
      user: { uid: 'guest-1' },
      params: { id: 'res-123' },
      body: { reason: 'Trying to cancel again' },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await cancelReservationHandler(req, res)

    expect(reservationRepo.updateReservationCancellation).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'res-123',
        status: 'cancelled',
        party: 'guest',
      })
    )
  })

  it('returns 409 RESERVATION_NOT_CANCELLABLE when status is funded', async () => {
    const fundedReservation: reservationRepo.ReservationRow = {
      ...mockReservation,
      status: 'funded',
      escrow_id: 'escrow-1',
      contract_id: 'contract-abc',
    }

    ;(reservationRepo.findReservationById as jest.Mock).mockResolvedValue(fundedReservation)

    const req = {
      user: { uid: 'guest-1' },
      params: { id: 'res-123' },
      body: {},
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await cancelReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      error: 'RESERVATION_NOT_CANCELLABLE',
      status: 'funded',
    })
    expect(reservationRepo.updateReservationCancellation).not.toHaveBeenCalled()
  })

  it('returns 409 RESERVATION_NOT_CANCELLABLE when status is completed or checked_in', async () => {
    const completedReservation: reservationRepo.ReservationRow = {
      ...mockReservation,
      status: 'completed',
    }

    ;(reservationRepo.findReservationById as jest.Mock).mockResolvedValue(completedReservation)

    const req = {
      user: { uid: 'owner-1' },
      params: { id: 'res-123' },
      body: {},
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await cancelReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      error: 'RESERVATION_NOT_CANCELLABLE',
      status: 'completed',
    })
    expect(reservationRepo.updateReservationCancellation).not.toHaveBeenCalled()
  })

  it('returns 409 when updateReservationCancellation returns false and reservation transitioned to funded concurrently', async () => {
    const fundedReservation: reservationRepo.ReservationRow = {
      ...mockReservation,
      status: 'funded',
    }

    ;(reservationRepo.findReservationById as jest.Mock)
      .mockResolvedValueOnce(mockReservation) // initial read: pending
      .mockResolvedValueOnce(fundedReservation) // re-read: funded
    ;(reservationRepo.updateReservationCancellation as jest.Mock).mockResolvedValue(false)

    const req = {
      user: { uid: 'guest-1' },
      params: { id: 'res-123' },
      body: {},
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await cancelReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      error: 'RESERVATION_NOT_CANCELLABLE',
      status: 'funded',
    })
  })

  it('returns 404 when reservation is deleted concurrently after cancel attempt', async () => {
    ;(reservationRepo.findReservationById as jest.Mock)
      .mockResolvedValueOnce(mockReservation) // initial read: pending
      .mockResolvedValueOnce(null) // re-read: null
    ;(reservationRepo.updateReservationCancellation as jest.Mock).mockResolvedValue(false)

    const req = {
      user: { uid: 'guest-1' },
      params: { id: 'res-123' },
      body: {},
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await cancelReservationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Reservation not found' })
  })
})
