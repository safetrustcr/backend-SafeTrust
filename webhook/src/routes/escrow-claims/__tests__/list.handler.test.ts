'use strict'

import { Response } from 'express'
import { listClaimsHandler } from '../list.handler'
import { pool } from '../../../services/db'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'

jest.mock('../../../services/db', () => ({
  pool: {
    connect: jest.fn(),
    query: jest.fn(),
  },
}))

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
  let mockClient: { query: jest.Mock; release: jest.Mock }

  let errorSpy: jest.SpyInstance

  afterEach(() => {
    errorSpy.mockRestore()
  })

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.clearAllMocks()
    mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() }
    ;(pool.connect as jest.Mock).mockResolvedValue(mockClient)
  })

  it('returns 200 with the claims of both parties for a participant', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('safetrust.reservations')) {
        return { rows: [{ reservation_id: 'res-1', status: 'completed' }] }
      }
      return {
        rows: [
          {
            id: 'c2',
            author_id: 'host-1',
            body: 'second claim body',
            status: 'in_review',
            created_at: 't2',
            updated_at: 't3',
          },
          {
            id: 'c1',
            author_id: 'guest-1',
            body: 'first claim body',
            status: 'submitted',
            created_at: 't1',
            updated_at: 't1',
          },
        ],
      }
    })
    const res = makeRes()
    await listClaimsHandler(makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(
      mockClient.query.mock.calls.some((c) => (c[0] as string).includes('FOR SHARE'))
    ).toBe(false)
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
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('returns 404 for a stranger', async () => {
    const res = makeRes()
    await listClaimsHandler(makeReq({ user: { uid: 'stranger' } }), res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'ESCROW_NOT_FOUND' })
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('returns 401 without a uid', async () => {
    const res = makeRes()
    await listClaimsHandler(makeReq({ user: undefined }), res)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('returns 400 for a malformed escrowId', async () => {
    const res = makeRes()
    await listClaimsHandler(makeReq({ params: { escrowId: 'x' } }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_CLAIM_REQUEST' })
  })

  it('returns 500 and releases the client when the database throws', async () => {
    mockClient.query.mockRejectedValue(new Error('db down'))
    const res = makeRes()
    await listClaimsHandler(makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'INTERNAL_ERROR' })
    expect(mockClient.release).toHaveBeenCalled()
  })
})
