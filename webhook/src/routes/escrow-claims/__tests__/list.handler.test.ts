'use strict'

import { Response } from 'express'
import { listClaimsHandler } from '../list.handler'
import { runHandler } from '../../__tests__/run-handler'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { listForParticipant } from '../../../repositories/escrow-claims.repository'

jest.mock('../../../repositories/escrow-claims.repository', () => ({ listForParticipant: jest.fn() }))

const ESCROW_ID = '11111111-1111-4111-8111-111111111111'

function makeReq(overrides: Record<string, unknown> = {}): AuthenticatedRequest {
  return {
    user: { uid: 'host-1' },
    params: { escrowId: ESCROW_ID },
    ...overrides,
  } as unknown as AuthenticatedRequest
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response & { status: jest.Mock; json: jest.Mock }
}

describe('listClaimsHandler', () => {
  let errorSpy: jest.SpyInstance

  afterEach(() => {
    errorSpy.mockRestore()
  })

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.clearAllMocks()
  })

  it('returns 200 with the claims of both parties for a participant', async () => {
    ;(listForParticipant as jest.Mock).mockResolvedValue([
      { id: 'c2', author_id: 'host-1', body: 'second claim body', status: 'in_review', created_at: 't2', updated_at: 't3' },
      { id: 'c1', author_id: 'guest-1', body: 'first claim body', status: 'submitted', created_at: 't1', updated_at: 't1' },
    ])
    const res = makeRes()
    await runHandler(listClaimsHandler, makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(listForParticipant).toHaveBeenCalledWith(ESCROW_ID, 'host-1')
    expect(res.json).toHaveBeenCalledWith({
      claims: [
        {
          id: 'c2',
          authorId: 'host-1',
          body: 'second claim body',
          status: 'in_review',
          createdAt: 't2',
          updatedAt: 't3',
        },
        {
          id: 'c1',
          authorId: 'guest-1',
          body: 'first claim body',
          status: 'submitted',
          createdAt: 't1',
          updatedAt: 't1',
        },
      ],
    })
  })

  it('returns 404 for a stranger', async () => {
    ;(listForParticipant as jest.Mock).mockResolvedValue(null)
    const res = makeRes()
    await runHandler(listClaimsHandler, makeReq({ user: { uid: 'stranger' } }), res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'ESCROW_NOT_FOUND' }))
  })

  it('returns 401 without a uid', async () => {
    const res = makeRes()
    await runHandler(listClaimsHandler, makeReq({ user: undefined }), res)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('returns 400 for a malformed escrowId', async () => {
    const res = makeRes()
    await runHandler(listClaimsHandler, makeReq({ params: { escrowId: 'x' } }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'INVALID_CLAIM_REQUEST' }))
  })

  it('returns 500 and releases the client when the database throws', async () => {
    ;(listForParticipant as jest.Mock).mockRejectedValue(new Error('db down'))
    const res = makeRes()
    await runHandler(listClaimsHandler, makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Internal server error' }))
  })
})
