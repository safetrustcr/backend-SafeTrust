'use strict'

import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { updateBidRequest } from '../../../services/bid-request.service'
import { updateBidRequestHandler, VALID_TRANSITIONS } from '../update.handler'

jest.mock('../../../services/bid-request.service', () => ({
  updateBidRequest: jest.fn(),
  VALID_TRANSITIONS: { PENDING: ['APPROVED', 'CANCELLED'], APPROVED: ['CONFIRMED', 'CANCELLED'] },
}))

describe('updateBidRequestHandler', () => {
  beforeEach(() => jest.clearAllMocks())

  it('exports valid state transitions', () => {
    expect(VALID_TRANSITIONS.PENDING).toEqual(['APPROVED', 'CANCELLED'])
    expect(VALID_TRANSITIONS.APPROVED).toEqual(['CONFIRMED', 'CANCELLED'])
  })

  it('returns 400 when status is missing', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response
    await updateBidRequestHandler({
      user: { uid: 'owner-1' }, params: { id: 'bid-1' }, body: {},
    } as unknown as AuthenticatedRequest, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(updateBidRequest).not.toHaveBeenCalled()
  })

  it.each([
    ['profile-missing', 409, {
      error: 'User profile not found',
      detail: 'Call POST /api/auth/sync-user before updating bid requests.',
    }],
    ['not-found', 404, { error: 'Bid not found' }],
    ['not-owner', 403, { error: 'Only owner can approve' }],
    ['invalid-transition', 400, { error: 'Invalid transition', allowedTransitions: ['APPROVED', 'CANCELLED'] }],
  ] as const)('maps service result %s to the existing response', async (kind, status, body) => {
    const result = kind === 'invalid-transition'
      ? { kind, allowedTransitions: ['APPROVED', 'CANCELLED'] }
      : { kind }
    ;(updateBidRequest as jest.Mock).mockResolvedValue(result)
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response
    await updateBidRequestHandler({
      user: { uid: 'owner-1' }, params: { id: 'bid-1' }, body: { status: 'APPROVED' },
    } as unknown as AuthenticatedRequest, res)
    expect(res.status).toHaveBeenCalledWith(status)
    expect(res.json).toHaveBeenCalledWith(body)
  })

  it('returns the updated bid after a successful service call', async () => {
    const bid = { id: 'bid-1', current_status: 'APPROVED' }
    ;(updateBidRequest as jest.Mock).mockResolvedValue({ kind: 'updated', bid })
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response
    await updateBidRequestHandler({
      user: { uid: 'owner-1' }, params: { id: 'bid-1' }, body: { status: 'APPROVED' },
    } as unknown as AuthenticatedRequest, res)
    expect(updateBidRequest).toHaveBeenCalledWith('owner-1', 'bid-1', 'APPROVED')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ bid })
  })
})
