import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { meHandler } from '../me.handler'
import { hasuraRequest } from '../../../services/hasura'

jest.mock('../../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
}))

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

function makeRequest(uid = 'user-1', email = 'test@example.com'): AuthenticatedRequest {
  return {
    user: { uid, email } as any,
  } as AuthenticatedRequest
}

describe('meHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns escrow-dashboard redirect for host role', async () => {
    ;(hasuraRequest as jest.Mock).mockResolvedValue({
      user_roles: [{ role: { name: 'host' } }],
    })

    const req = makeRequest('host-1', 'host@example.com')
    const res = makeResponse()

    await meHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      user: {
        id: 'host-1',
        email: 'host@example.com',
        roles: ['host'],
      },
      redirect: '/dashboard/escrow-dashboard',
    })
  })

  it('returns escrow-dashboard redirect for admin role', async () => {
    ;(hasuraRequest as jest.Mock).mockResolvedValue({
      user_roles: [{ role: { name: 'admin' } }],
    })

    const req = makeRequest('admin-1', 'admin@example.com')
    const res = makeResponse()

    await meHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      user: {
        id: 'admin-1',
        email: 'admin@example.com',
        roles: ['admin'],
      },
      redirect: '/dashboard/escrow-dashboard',
    })
  })

  it('returns guest redirect for guest role', async () => {
    ;(hasuraRequest as jest.Mock).mockResolvedValue({
      user_roles: [{ role: { name: 'guest' } }],
    })

    const req = makeRequest('guest-1', 'guest@example.com')
    const res = makeResponse()

    await meHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      user: {
        id: 'guest-1',
        email: 'guest@example.com',
        roles: ['guest'],
      },
      redirect: '/dashboard/guest',
    })
  })

  it('returns 500 when hasura request fails', async () => {
    ;(hasuraRequest as jest.Mock).mockRejectedValue(new Error('Hasura error'))

    const req = makeRequest()
    const res = makeResponse()

    await meHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to resolve user roles' })
  })
})
