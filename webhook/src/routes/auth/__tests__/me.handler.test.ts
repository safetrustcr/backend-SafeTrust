import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { meHandler } from '../me.handler'
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

describe('auth/me.handler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    const req = {} as unknown as AuthenticatedRequest
    const res = makeResponse()

    await meHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
  })

  it('reads roles from req.context without querying the database', async () => {
    const req = {
      context: {
        uid: 'user-guest-1',
        tenantId: 'safetrust',
        roles: ['guest'],
        email: 'guest@example.com',
      },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await meHandler(req, res)

    expect(query).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      user: {
        id: 'user-guest-1',
        email: 'guest@example.com',
        roles: ['guest'],
      },
      redirect: '/dashboard/guest',
    })
  })

  it('redirects host to escrow-dashboard using context roles', async () => {
    const req = {
      context: {
        uid: 'user-host-1',
        tenantId: 'safetrust',
        roles: ['guest', 'host'],
        email: 'host@example.com',
      },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await meHandler(req, res)

    expect(query).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      user: {
        id: 'user-host-1',
        email: 'host@example.com',
        roles: ['guest', 'host'],
      },
      redirect: '/dashboard/escrow-dashboard',
    })
  })

  it('falls back to database query if roles are not present on context or user', async () => {
    ;(query as jest.Mock).mockResolvedValueOnce({
      rows: [{ name: 'admin' }],
    })

    const req = {
      user: {
        uid: 'user-legacy-1',
        email: 'admin@example.com',
        role: 'admin',
        roles: [],
      },
    } as unknown as AuthenticatedRequest
    const res = makeResponse()

    await meHandler(req, res)

    expect(query).toHaveBeenCalledWith(expect.any(String), ['user-legacy-1'])
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      user: {
        id: 'user-legacy-1',
        email: 'admin@example.com',
        roles: ['admin'],
      },
      redirect: '/dashboard/escrow-dashboard',
    })
  })
})
