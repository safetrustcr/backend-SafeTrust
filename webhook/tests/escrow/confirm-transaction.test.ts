import express from 'express'
import request from 'supertest'
import confirmTransactionRoute from '../../src/routes/escrows/confirm-transaction.route'
import db from '../../src/services/db'
import { sendTransactionViaTWHelper } from '../../src/services/confirmation.service'

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}))

jest.mock('../../src/services/db', () => {
  const query = jest.fn()
  return {
    __esModule: true,
    default: { query },
    query,
    withTransaction: jest.fn(async (callback: (client: { query: typeof query }) => unknown) =>
      callback({ query })
    ),
  }
})

const mockedDbQuery = db.query as jest.MockedFunction<typeof db.query>

describe('POST /api/escrows/confirm-transaction', () => {
  const txHash = 'b'.repeat(64)
  const escrowId = 'contract-xyz-123'
  let app: express.Express
  let twFetch: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    app = express()
    app.use(express.json())
    app.use(confirmTransactionRoute)
    twFetch = jest.fn()
    global.fetch = twFetch
  })

  afterEach(() => {
    delete (global as any).fetch
  })

  const authenticatedRequest = () =>
    request(app)
      .post('/api/escrows/confirm-transaction')
      .set('Authorization', ['Bearer', 'mock-token'].join(' '))
      .set('x-test-uid', 'caller-uid')

  it('returns 401 before any database or Trustless Work call when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/escrows/confirm-transaction')
      .send({ txHash, escrowId, action: 'fund' })

    expect(res.status).toBe(401)
    expect(mockedDbQuery).not.toHaveBeenCalled()
    expect(twFetch).not.toHaveBeenCalled()
  })

  it('returns 403 for an authenticated caller who is not an escrow party', async () => {
    mockedDbQuery
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ is_party: false }] } as any)

    const res = await authenticatedRequest().send({
      submissionPath: 'external',
      txHash,
      escrowId,
      action: 'fund',
      network: 'testnet',
    })

    expect(res.status).toBe(403)
    expect(res.body.message).toContain('not a recognized party')
    expect(mockedDbQuery).toHaveBeenCalledTimes(2)
    expect(twFetch).not.toHaveBeenCalled()
  })

  it('allows an authenticated escrow party and calls the V1 indexer contract shape', async () => {
    mockedDbQuery
      .mockResolvedValueOnce({ rows: [{ name: 'guest' }] } as any)
      .mockResolvedValueOnce({ rows: [{ is_party: true }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'retry-1' }] } as any)
      .mockResolvedValue({ rows: [] } as any)

    twFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ successful: true, ledger: 12345 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'OK',
      })

    const res = await authenticatedRequest().send({
      submissionPath: 'external',
      txHash,
      escrowId,
      action: 'fund',
      network: 'testnet',
    })

    expect(res.status).toBe(200)
    expect(twFetch).toHaveBeenNthCalledWith(
      2,
      'https://dev.api.trustlesswork.com/indexer/update-from-txhash',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ txHash }),
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    )

    const ownershipQuery = mockedDbQuery.mock.calls[1]
    expect(ownershipQuery[1]).toEqual(['caller-uid', escrowId, 'safetrust'])
    for (const role of [
      'approver',
      'serviceProvider',
      'platformAddress',
      'releaseSigner',
      'disputeResolver',
      'receiver',
    ]) {
      expect(ownershipQuery[0]).toContain(`roles,${role}`)
    }
  })

  it('sends signed XDR and network to the helper endpoint', async () => {
    twFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ txHash }),
    })

    const result = await sendTransactionViaTWHelper('SIGNED_XDR', 'testnet')

    expect(result).toEqual({ success: true, txHash })
    expect(twFetch).toHaveBeenCalledWith(
      'https://dev.api.trustlesswork.com/helper/send-transaction',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ signedXdr: 'SIGNED_XDR', network: 'testnet' }),
      })
    )
  })
})
