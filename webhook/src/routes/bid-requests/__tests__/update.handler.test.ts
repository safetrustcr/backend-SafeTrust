'use strict'

import { Response } from 'express'
import { updateBidRequestHandler, VALID_TRANSITIONS } from '../update.handler'
import { pool } from '../../../services/db'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'

jest.mock('../../../services/db', () => ({
  pool: {
    connect: jest.fn(),
  },
}))

describe('updateBidRequestHandler', () => {
  let mockClient: {
    query: jest.Mock
    release: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }
    ;(pool.connect as jest.Mock).mockResolvedValue(mockClient)
  })

  it('exports VALID_TRANSITIONS correctly', () => {
    expect(VALID_TRANSITIONS.PENDING).toEqual(['APPROVED', 'CANCELLED'])
    expect(VALID_TRANSITIONS.APPROVED).toEqual(['CONFIRMED', 'CANCELLED'])
  })

  it('returns 400 when status is missing from body', async () => {
    const req = {
      user: { uid: 'owner-1' },
      params: { id: 'bid-1' },
      body: {},
    } as unknown as AuthenticatedRequest

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await updateBidRequestHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing required field: status' })
  })

  it('returns 409 when user profile is not found', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT user -> empty

    const req = {
      user: { uid: 'unregistered-uid' },
      params: { id: 'bid-1' },
      body: { status: 'APPROVED' },
    } as unknown as AuthenticatedRequest

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await updateBidRequestHandler(req, res)

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    expect(mockClient.release).toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      error: 'User profile not found',
      detail: 'Call POST /api/auth/sync-user before updating bid requests.',
    })
  })

  it('returns 404 when bid is not found', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'owner-1' }] }) // user found
      .mockResolvedValueOnce({ rows: [] }) // GET_BID -> empty

    const req = {
      user: { uid: 'owner-1' },
      params: { id: 'non-existent-bid' },
      body: { status: 'APPROVED' },
    } as unknown as AuthenticatedRequest

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await updateBidRequestHandler(req, res)

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Bid not found' })
  })

  it('returns 403 when caller is not the apartment owner', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'other-user' }] }) // user found
      .mockResolvedValueOnce({
        rows: [{ id: 'bid-1', owner_id: 'real-owner', current_status: 'PENDING' }],
      }) // GET_BID

    const req = {
      user: { uid: 'other-user' },
      params: { id: 'bid-1' },
      body: { status: 'APPROVED' },
    } as unknown as AuthenticatedRequest

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await updateBidRequestHandler(req, res)

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Only owner can approve' })
  })

  it('returns 400 when transition is invalid', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'owner-1' }] }) // user found
      .mockResolvedValueOnce({
        rows: [{ id: 'bid-1', owner_id: 'owner-1', current_status: 'PENDING' }],
      }) // GET_BID

    const req = {
      user: { uid: 'owner-1' },
      params: { id: 'bid-1' },
      body: { status: 'CONFIRMED' }, // Not allowed directly from PENDING
    } as unknown as AuthenticatedRequest

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await updateBidRequestHandler(req, res)

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid transition',
      allowedTransitions: ['APPROVED', 'CANCELLED'],
    })
  })

  it('returns 200 and updates bid status on valid transition', async () => {
    const updatedBid = {
      id: 'bid-1',
      current_status: 'APPROVED',
      apartment_id: 'apt-1',
      tenant_id: 'tenant-1',
    }

    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'owner-1' }] }) // user found
      .mockResolvedValueOnce({
        rows: [{ id: 'bid-1', owner_id: 'owner-1', current_status: 'PENDING' }],
      }) // GET_BID
      .mockResolvedValueOnce({ rows: [updatedBid] }) // UPDATE_BID
      .mockResolvedValueOnce({}) // INSERT_HISTORY
      .mockResolvedValueOnce({}) // COMMIT

    const req = {
      user: { uid: 'owner-1' },
      params: { id: 'bid-1' },
      body: { status: 'APPROVED' },
    } as unknown as AuthenticatedRequest

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await updateBidRequestHandler(req, res)

    expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ bid: updatedBid })
  })

  it('returns 500 and rolls back when an unexpected error occurs', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(new Error('Connection dropped'))

    const req = {
      user: { uid: 'owner-1' },
      params: { id: 'bid-1' },
      body: { status: 'APPROVED' },
    } as unknown as AuthenticatedRequest

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await updateBidRequestHandler(req, res)

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to update bid request' })
  })
})
