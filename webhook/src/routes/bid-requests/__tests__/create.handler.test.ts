'use strict'

import { Response } from 'express'
import { createBidRequestHandler, isValidCalendarDate } from '../create.handler'
import { query } from '../../../services/db'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'

jest.mock('../../../services/db', () => ({
  query: jest.fn(),
}))

describe('createBidRequestHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('isValidCalendarDate', () => {
    it('accepts valid calendar dates', () => {
      expect(isValidCalendarDate('2026-09-01')).toBe(true)
      expect(isValidCalendarDate('2024-02-29')).toBe(true) // leap year
      expect(isValidCalendarDate('2026-12-31T23:59:59.000Z')).toBe(true)
    })

    it('rejects invalid calendar dates including overflow normalization cases', () => {
      expect(isValidCalendarDate('2026-02-30')).toBe(false) // Feb 30 does not exist
      expect(isValidCalendarDate('2026-04-31')).toBe(false) // April has 30 days
      expect(isValidCalendarDate('2025-02-29')).toBe(false) // non-leap year Feb 29
      expect(isValidCalendarDate('not-a-date')).toBe(false)
      expect(isValidCalendarDate('')).toBe(false)
    })
  })

  it('returns 400 when required fields are missing', async () => {
    const req = {
      user: { uid: 'tenant-123' },
      body: {},
    } as unknown as AuthenticatedRequest & { body: any }

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await createBidRequestHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields' })
  })

  it('returns 400 when proposedPrice is not positive', async () => {
    const req = {
      user: { uid: 'tenant-123' },
      body: {
        apartmentId: '123e4567-e89b-12d3-a456-426614174000',
        proposedPrice: -50,
        desiredMoveIn: '2026-09-01',
      },
    } as unknown as AuthenticatedRequest & { body: any }

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await createBidRequestHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'proposedPrice must be a positive number' })
  })

  it('returns 400 when desiredMoveIn is an invalid date string', async () => {
    const req = {
      user: { uid: 'tenant-123' },
      body: {
        apartmentId: '123e4567-e89b-12d3-a456-426614174000',
        proposedPrice: 1000,
        desiredMoveIn: 'not-a-date',
      },
    } as unknown as AuthenticatedRequest & { body: any }

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await createBidRequestHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'desiredMoveIn must be a valid date' })
  })

  it('returns 400 when desiredMoveIn is a calendar-invalid date (e.g. 2026-02-30)', async () => {
    const req = {
      user: { uid: 'tenant-123' },
      body: {
        apartmentId: '123e4567-e89b-12d3-a456-426614174000',
        proposedPrice: 1000,
        desiredMoveIn: '2026-02-30',
      },
    } as unknown as AuthenticatedRequest & { body: any }

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await createBidRequestHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'desiredMoveIn must be a valid date' })
  })

  it('returns 409 when user already has an active bid in DB pre-check', async () => {
    ;(query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 'existing-bid-id' }],
    })

    const req = {
      user: { uid: 'tenant-123' },
      body: {
        apartmentId: '123e4567-e89b-12d3-a456-426614174000',
        proposedPrice: 1000,
        desiredMoveIn: '2026-09-01',
      },
    } as unknown as AuthenticatedRequest & { body: any }

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await createBidRequestHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'Duplicate pending bid' })
  })

  it('returns 201 on successful bid creation', async () => {
    ;(query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] }) // EXISTING_ACTIVE check
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'bid-new-1',
            apartment_id: '123e4567-e89b-12d3-a456-426614174000',
            tenant_id: 'tenant-123',
            proposed_price: 1000,
            desired_move_in: '2026-09-01T00:00:00.000Z',
            current_status: 'PENDING',
          },
        ],
      })

    const req = {
      user: { uid: 'tenant-123' },
      body: {
        apartment_id: '123e4567-e89b-12d3-a456-426614174000',
        proposed_price: 1000,
        desired_move_in: '2026-09-01',
      },
    } as unknown as AuthenticatedRequest & { body: any }

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await createBidRequestHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({
      bid: expect.objectContaining({
        id: 'bid-new-1',
        current_status: 'PENDING',
      }),
    })
  })

  it('returns 409 when database trigger raises active bid exception', async () => {
    ;(query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('Tenant already has an active bid on file'))

    const req = {
      user: { uid: 'tenant-123' },
      body: {
        apartmentId: '123e4567-e89b-12d3-a456-426614174000',
        proposedPrice: 1000,
        desiredMoveIn: '2026-09-01',
      },
    } as unknown as AuthenticatedRequest & { body: any }

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await createBidRequestHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'Duplicate pending bid' })
  })

  it('returns 500 when database throws general error', async () => {
    ;(query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('Database unavailable'))

    const req = {
      user: { uid: 'tenant-123' },
      body: {
        apartmentId: '123e4567-e89b-12d3-a456-426614174000',
        proposedPrice: 1000,
        desiredMoveIn: '2026-09-01',
      },
    } as unknown as AuthenticatedRequest & { body: any }

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await createBidRequestHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to create bid request' })
  })
})
