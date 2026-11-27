import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { syncUserHandler } from '../sync-user.handler'
import { runHandler } from '../../__tests__/run-handler'
import { syncUser } from '../../../repositories/user.repository'
import { syncClaims } from '../../../services/claims'

jest.mock('../../../repositories/user.repository', () => ({ syncUser: jest.fn() }))
jest.mock('../../../services/claims', () => ({ syncClaims: jest.fn() }))

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

describe('auth/sync-user.handler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(syncClaims as jest.Mock).mockResolvedValue(true)
  })

  it('returns 401 when unauthenticated', async () => {
    const req = {} as AuthenticatedRequest
    const res = makeResponse()

    await runHandler(syncUserHandler, req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Unauthorized' }))
  })

  it('reconciles and updates existing user matching id or firebase_uid without querying information_schema', async () => {
    const mockUser = {
      id: 'firebase-user-123',
      firebase_uid: 'firebase-user-123',
      email: 'user@example.com',
      last_seen: new Date('2026-10-21T06:00:00.000Z'),
    }

    ;(syncUser as jest.Mock).mockResolvedValueOnce(mockUser)

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

    await runHandler(syncUserHandler, req, res)

    expect(syncUser).toHaveBeenCalledWith('firebase-user-123', 'user@example.com')
    expect(syncClaims).toHaveBeenCalledWith('firebase-user-123')

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      claimsUpdated: true,
      user: {
        id: 'firebase-user-123',
        email: 'user@example.com',
        role: 'guest',
        last_seen: mockUser.last_seen,
      },
    })
  })

  it('reconciles legacy user row where id differs from firebase_uid', async () => {
    const legacyUser = {
      id: 'legacy-uuid-456',
      firebase_uid: 'firebase-user-456',
      email: 'legacy@example.com',
      last_seen: new Date('2026-10-21T06:00:00.000Z'),
    }

    ;(syncUser as jest.Mock).mockResolvedValueOnce(legacyUser)

    const req = {
      context: {
        uid: 'firebase-user-456',
        tenantId: 'safetrust',
        roles: ['host'],
        email: 'legacy@example.com',
      },
    } as AuthenticatedRequest
    const res = makeResponse()

    await runHandler(syncUserHandler, req, res)

    expect(syncUser).toHaveBeenCalledWith('firebase-user-456', 'legacy@example.com')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      claimsUpdated: true,
      user: {
        id: 'legacy-uuid-456',
        email: 'legacy@example.com',
        role: 'host',
        last_seen: legacyUser.last_seen,
      },
    })
  })

  it('inserts new user when no matching row exists', async () => {
    const newUser = {
      id: 'new-user-789',
      firebase_uid: 'new-user-789',
      email: 'new@example.com',
      last_seen: new Date('2026-10-21T06:00:00.000Z'),
    }

    ;(syncUser as jest.Mock).mockResolvedValueOnce(newUser)

    const req = {
      context: {
        uid: 'new-user-789',
        tenantId: 'safetrust',
        roles: ['guest'],
        email: 'new@example.com',
      },
    } as AuthenticatedRequest
    const res = makeResponse()

    await runHandler(syncUserHandler, req, res)

    expect(syncUser).toHaveBeenCalledWith('new-user-789', 'new@example.com')

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      claimsUpdated: true,
      user: {
        id: 'new-user-789',
        email: 'new@example.com',
        role: 'guest',
        last_seen: newUser.last_seen,
      },
    })
  })

  it('reports claimsUpdated false when the claims did not change', async () => {
    ;(syncUser as jest.Mock).mockResolvedValueOnce({
      id: 'unchanged-user',
      firebase_uid: 'unchanged-user',
      email: 'unchanged@example.com',
    })
    ;(syncClaims as jest.Mock).mockResolvedValueOnce(false)

    const req = {
      context: {
        uid: 'unchanged-user',
        tenantId: 'safetrust',
        roles: ['guest'],
      },
    } as AuthenticatedRequest
    const res = makeResponse()

    await runHandler(syncUserHandler, req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ claimsUpdated: false }),
    )
  })

  it('returns 500 when database error occurs', async () => {
    ;(syncUser as jest.Mock).mockRejectedValueOnce(new Error('Connection failure'))

    const req = {
      context: {
        uid: 'firebase-user-123',
        tenantId: 'safetrust',
        roles: ['guest'],
        email: 'user@example.com',
      },
    } as AuthenticatedRequest
    const res = makeResponse()

    await runHandler(syncUserHandler, req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Internal server error' }))
  })
})
