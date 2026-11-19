import { createHash } from 'node:crypto'
import { Response } from 'express'
import { connect, query } from '../../../services/db'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import {
  listWalletsHandler,
  unlinkWalletHandler,
  setPrimaryWalletHandler,
} from '../wallets.handler'

jest.mock('../../../services/db', () => ({
  connect: jest.fn(),
  query: jest.fn(),
}))

const WALLET_1 = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57'
const WALLET_2 = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
const WALLET_OTHER_USER = 'GCXMWUAU7U4PZ4V4G76XJPLK2M3Z67T6L5K4F3XUQUJ2P266G62K2P6G'

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  res.end = jest.fn().mockReturnValue(res)
  return res as Response
}

function makeRequest(
  params: Record<string, string> = {},
  uid: string = 'user-1'
): AuthenticatedRequest {
  return {
    user: { uid, role: 'tenant', roles: ['tenant'] },
    params,
    body: {},
  } as unknown as AuthenticatedRequest
}

function makeClient(queryFn: jest.Mock) {
  return { query: queryFn, release: jest.fn() }
}

describe('wallets handler registry endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('GET /api/auth/wallets', () => {
    it('returns 401 when request is not authenticated', async () => {
      const req = { user: undefined, params: {}, body: {} } as unknown as AuthenticatedRequest
      const res = makeResponse()

      await listWalletsHandler(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({ error: 'UNAUTHORIZED' })
    })

    it('returns caller wallets ordered with primary first and resolves signInWallet', async () => {
      const uid = `stellar_${createHash('sha256').update(WALLET_1).digest('hex')}`
      const req = makeRequest({}, uid)
      const res = makeResponse()

      const mockRows = [
        {
          wallet_address: WALLET_1,
          chain_type: 'STELLAR',
          is_primary: true,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          wallet_address: WALLET_2,
          chain_type: 'STELLAR',
          is_primary: false,
          created_at: new Date('2026-01-02T00:00:00.000Z'),
        },
      ]

      ;(query as jest.Mock).mockResolvedValueOnce({ rows: mockRows })

      await listWalletsHandler(req, res)

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('FROM safetrust.user_wallets WHERE user_id = $1'),
        [uid]
      )
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        wallets: [
          {
            address: WALLET_1,
            chain: 'STELLAR',
            isPrimary: true,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          {
            address: WALLET_2,
            chain: 'STELLAR',
            isPrimary: false,
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        signInWallet: WALLET_1,
      })
    })

    it('sets signInWallet to null for non-wallet accounts (e.g. email/Google)', async () => {
      const req = makeRequest({}, 'firebase-email-user-123')
      const res = makeResponse()

      const mockRows = [
        {
          wallet_address: WALLET_2,
          chain_type: 'STELLAR',
          is_primary: true,
          created_at: new Date('2026-01-02T00:00:00.000Z'),
        },
      ]

      ;(query as jest.Mock).mockResolvedValueOnce({ rows: mockRows })

      await listWalletsHandler(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        wallets: [
          {
            address: WALLET_2,
            chain: 'STELLAR',
            isPrimary: true,
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        signInWallet: null,
      })
    })
  })

  describe('DELETE /api/auth/wallets/:address', () => {
    it('returns 400 for an invalid wallet address', async () => {
      const req = makeRequest({ address: 'invalid-address-string' })
      const res = makeResponse()

      await unlinkWalletHandler(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_WALLET_ADDRESS' })
    })

    it('returns 409 when attempting to unlink the sign-in wallet', async () => {
      const uid = `stellar_${createHash('sha256').update(WALLET_1).digest('hex')}`
      const req = makeRequest({ address: WALLET_1 }, uid)
      const res = makeResponse()

      await unlinkWalletHandler(req, res)

      expect(res.status).toHaveBeenCalledWith(409)
      expect(res.json).toHaveBeenCalledWith({ error: 'WALLET_IS_SIGN_IN_METHOD' })
      expect(connect).not.toHaveBeenCalled()
    })

    it('returns 404 if the wallet is not found for the user (user isolation)', async () => {
      const req = makeRequest({ address: WALLET_OTHER_USER }, 'user-1')
      const res = makeResponse()

      const clientQuery = jest.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN') return {}
        if (sql.includes('DELETE FROM safetrust.user_wallets')) {
          return { rowCount: 0, rows: [] }
        }
        if (sql === 'ROLLBACK') return {}
        return {}
      })
      const client = makeClient(clientQuery)
      ;(connect as jest.Mock).mockResolvedValueOnce(client)

      await unlinkWalletHandler(req, res)

      expect(clientQuery).toHaveBeenCalledWith('BEGIN')
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM safetrust.user_wallets WHERE user_id = $1 AND wallet_address = $2'),
        ['user-1', WALLET_OTHER_USER]
      )
      expect(clientQuery).toHaveBeenCalledWith('ROLLBACK')
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({ error: 'WALLET_NOT_FOUND' })
      expect(client.release).toHaveBeenCalled()
    })

    it('deletes a non-primary wallet without triggering primary promotion', async () => {
      const req = makeRequest({ address: WALLET_2 }, 'user-1')
      const res = makeResponse()

      const clientQuery = jest.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN') return {}
        if (sql.includes('DELETE FROM safetrust.user_wallets')) {
          return { rowCount: 1, rows: [{ is_primary: false }] }
        }
        if (sql === 'COMMIT') return {}
        return {}
      })
      const client = makeClient(clientQuery)
      ;(connect as jest.Mock).mockResolvedValueOnce(client)

      await unlinkWalletHandler(req, res)

      expect(clientQuery).toHaveBeenCalledWith('BEGIN')
      expect(clientQuery).toHaveBeenCalledWith('COMMIT')
      expect(clientQuery.mock.calls.some(([sql]: [string]) => sql.includes('UPDATE safetrust.user_wallets SET is_primary = true'))).toBe(false)
      expect(res.status).toHaveBeenCalledWith(204)
      expect(res.end).toHaveBeenCalled()
      expect(client.release).toHaveBeenCalled()
    })

    it('deletes a primary wallet and promotes the oldest remaining wallet in one transaction', async () => {
      const req = makeRequest({ address: WALLET_1 }, 'user-1')
      const res = makeResponse()

      const clientQuery = jest.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN') return {}
        if (sql.includes('DELETE FROM safetrust.user_wallets')) {
          return { rowCount: 1, rows: [{ is_primary: true }] }
        }
        if (sql.includes('UPDATE safetrust.user_wallets SET is_primary = true')) {
          return { rowCount: 1 }
        }
        if (sql === 'COMMIT') return {}
        return {}
      })
      const client = makeClient(clientQuery)
      ;(connect as jest.Mock).mockResolvedValueOnce(client)

      await unlinkWalletHandler(req, res)

      expect(clientQuery).toHaveBeenCalledWith('BEGIN')
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE safetrust.user_wallets SET is_primary = true'),
        ['user-1']
      )
      expect(clientQuery).toHaveBeenCalledWith('COMMIT')
      expect(res.status).toHaveBeenCalledWith(204)
      expect(res.end).toHaveBeenCalled()
      expect(client.release).toHaveBeenCalled()
    })
  })

  describe('POST /api/auth/wallets/:address/primary', () => {
    it('returns 400 for an invalid wallet address', async () => {
      const req = makeRequest({ address: 'short-addr' })
      const res = makeResponse()

      await setPrimaryWalletHandler(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_WALLET_ADDRESS' })
    })

    it('returns 404 if the wallet is not owned by the user (isolation)', async () => {
      const req = makeRequest({ address: WALLET_OTHER_USER }, 'user-1')
      const res = makeResponse()

      const clientQuery = jest.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN') return {}
        if (sql.includes('SELECT id, is_primary FROM safetrust.user_wallets')) {
          return { rowCount: 0, rows: [] }
        }
        if (sql === 'ROLLBACK') return {}
        return {}
      })
      const client = makeClient(clientQuery)
      ;(connect as jest.Mock).mockResolvedValueOnce(client)

      await setPrimaryWalletHandler(req, res)

      expect(clientQuery).toHaveBeenCalledWith('BEGIN')
      expect(clientQuery).toHaveBeenCalledWith('ROLLBACK')
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({ error: 'WALLET_NOT_FOUND' })
    })

    it('is idempotent when the wallet is already primary', async () => {
      const req = makeRequest({ address: WALLET_1 }, 'user-1')
      const res = makeResponse()

      const mockRows = [
        {
          wallet_address: WALLET_1,
          chain_type: 'STELLAR',
          is_primary: true,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]

      const clientQuery = jest.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN') return {}
        if (sql.includes('SELECT id, is_primary FROM safetrust.user_wallets')) {
          return { rowCount: 1, rows: [{ id: 'w-1', is_primary: true }] }
        }
        if (sql.includes('SELECT wallet_address, chain_type')) {
          return { rows: mockRows }
        }
        if (sql === 'COMMIT') return {}
        return {}
      })
      const client = makeClient(clientQuery)
      ;(connect as jest.Mock).mockResolvedValueOnce(client)

      await setPrimaryWalletHandler(req, res)

      expect(clientQuery.mock.calls.some(([sql]: [string]) => sql.includes('UPDATE safetrust.user_wallets'))).toBe(false)
      expect(clientQuery).toHaveBeenCalledWith('COMMIT')
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        wallets: [
          {
            address: WALLET_1,
            chain: 'STELLAR',
            isPrimary: true,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        signInWallet: null,
      })
    })

    it('clears previous primary and sets target wallet to primary in one transaction', async () => {
      const req = makeRequest({ address: WALLET_2 }, 'user-1')
      const res = makeResponse()

      const mockRows = [
        {
          wallet_address: WALLET_2,
          chain_type: 'STELLAR',
          is_primary: true,
          created_at: new Date('2026-01-02T00:00:00.000Z'),
        },
        {
          wallet_address: WALLET_1,
          chain_type: 'STELLAR',
          is_primary: false,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]

      const clientQuery = jest.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN') return {}
        if (sql.includes('SELECT id, is_primary FROM safetrust.user_wallets')) {
          return { rowCount: 1, rows: [{ id: 'w-2', is_primary: false }] }
        }
        if (sql.includes('SET is_primary = false')) return { rowCount: 1 }
        if (sql.includes('SET is_primary = true')) return { rowCount: 1 }
        if (sql.includes('SELECT wallet_address, chain_type')) {
          return { rows: mockRows }
        }
        if (sql === 'COMMIT') return {}
        return {}
      })
      const client = makeClient(clientQuery)
      ;(connect as jest.Mock).mockResolvedValueOnce(client)

      await setPrimaryWalletHandler(req, res)

      expect(clientQuery).toHaveBeenCalledWith('BEGIN')
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE safetrust.user_wallets SET is_primary = false'),
        ['user-1']
      )
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE safetrust.user_wallets SET is_primary = true'),
        ['user-1', WALLET_2]
      )
      expect(clientQuery).toHaveBeenCalledWith('COMMIT')
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        wallets: [
          {
            address: WALLET_2,
            chain: 'STELLAR',
            isPrimary: true,
            createdAt: '2026-01-02T00:00:00.000Z',
          },
          {
            address: WALLET_1,
            chain: 'STELLAR',
            isPrimary: false,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        signInWallet: null,
      })
    })
  })
})
