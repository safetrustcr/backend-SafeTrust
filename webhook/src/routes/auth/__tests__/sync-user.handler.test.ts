import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { syncUserHandler } from '../sync-user.handler'
import { query } from '../../../services/db'

jest.mock('../../../services/db', () => ({
  query: jest.fn(),
}))

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

describe('auth/sync-user.handler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    const req = {} as AuthenticatedRequest
    const res = makeResponse()

    await syncUserHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
  })

  it('syncs user with direct TEXT upsert and no information_schema query', async () => {
    const mockUser = {
      id: 'firebase-user-123',
      firebase_uid: 'firebase-user-123',
      email: 'user@example.com',
      last_seen: new Date('2026-10-21T06:00:00.000Z'),
    }

    ;(query as jest.Mock).mockResolvedValueOnce({
      rows: [mockUser],
    })

    const req = {
      context: {
        uid: 'firebase-user-123',
        tenantId: 'safetrust',
        roles: ['guest'],
        email: 'user@example.com',
      },
      user: {
        uid: 'firebase-user-123',
        email: 'user@example.com',
        role: 'guest',
        roles: ['guest'],
      },
    } as AuthenticatedRequest
    const res = makeResponse()

    await syncUserHandler(req, res)

    expect(query).toHaveBeenCalledTimes(1)
    const [sqlQuery, params] = (query as jest.Mock).mock.calls[0]
    expect(sqlQuery).toContain('INSERT INTO safetrust.users')
    expect(sqlQuery).not.toContain('information_schema')
    expect(params).toEqual(['firebase-user-123', 'user@example.com'])

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      user: {
        id: 'firebase-user-123',
        email: 'user@example.com',
        role: 'guest',
        last_seen: mockUser.last_seen,
      },
    })
  })

  it('returns 500 when database error occurs', async () => {
    ;(query as jest.Mock).mockRejectedValueOnce(new Error('Connection failure'))

    const req = {
      context: {
        uid: 'firebase-user-123',
        tenantId: 'safetrust',
        roles: ['guest'],
        email: 'user@example.com',
      },
    } as AuthenticatedRequest
    const res = makeResponse()

    await syncUserHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Database error' })
  })
})
