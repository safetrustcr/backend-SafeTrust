import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { syncUserHandler } from '../sync-user.handler'
import db from '../../../services/db'

jest.mock('../../../services/db', () => ({
  query: jest.fn(),
}))

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

function makeRequest(uid = 'user-1', email = 'test@example.com', role = 'guest'): AuthenticatedRequest {
  return {
    user: { uid, email, role } as any,
  } as AuthenticatedRequest
}

describe('syncUserHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('syncs user when column id type is text/default', async () => {
    ;(db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ data_type: 'text' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'user-1',
            firebase_uid: 'user-1',
            email: 'test@example.com',
            last_seen: '2026-08-18T10:00:00Z',
          },
        ],
      })

    const req = makeRequest()
    const res = makeResponse()

    await syncUserHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      user: {
        id: 'user-1',
        email: 'test@example.com',
        role: 'guest',
        last_seen: '2026-08-18T10:00:00Z',
      },
    })
  })

  it('returns 500 when db query fails', async () => {
    ;(db.query as jest.Mock).mockRejectedValue(new Error('db connection error'))

    const req = makeRequest()
    const res = makeResponse()

    await syncUserHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Database error' })
  })
})
