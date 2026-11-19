import { Response } from 'express'
import { connect } from '../../../services/db'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { createWalletChallengeHandler, verifyWalletChallengeHandler } from '../wallet-challenge.handler'

jest.mock('../../../services/db', () => ({ connect: jest.fn() }))
jest.mock('../../../../../crates/stellar-utils', () => ({
  validateStellarAddress: jest.fn(() => true),
  verifyStellarEd25519: jest.fn(() => true),
}), { virtual: true })

const ADDRESS = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57'

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

function makeRequest(body: Record<string, unknown>, uid = 'user-1'): AuthenticatedRequest {
  return { user: { uid }, body } as AuthenticatedRequest
}

function makeClient(query: jest.Mock) {
  return { query, release: jest.fn() }
}

describe('wallet ownership challenge handlers', () => {
  const originalDomain = process.env.WALLET_CHALLENGE_DOMAIN
  const originalNetwork = process.env.STELLAR_NETWORK

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.WALLET_CHALLENGE_DOMAIN = 'safetrust.example'
    process.env.STELLAR_NETWORK = 'testnet'
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
        signers: [{ key: ADDRESS, weight: 1 }],
      }),
    }) as jest.Mock
  })

  afterAll(() => {
    if (originalDomain === undefined) delete process.env.WALLET_CHALLENGE_DOMAIN
    else process.env.WALLET_CHALLENGE_DOMAIN = originalDomain
    if (originalNetwork === undefined) delete process.env.STELLAR_NETWORK
    else process.env.STELLAR_NETWORK = originalNetwork
  })

  it('creates a challenge bound to the authenticated user, tenant, domain, network and address', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] })
    ;(connect as jest.Mock).mockResolvedValue(makeClient(query))
    const res = makeResponse()

    await createWalletChallengeHandler(makeRequest({ wallet_address: ADDRESS }) as never, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const payload = (res.json as jest.Mock).mock.calls[0][0]
    expect(payload.challenge).toContain('"uid":"user-1"')
    expect(payload.challenge).toContain('"tenant":"safetrust"')
    expect(payload.challenge).toContain('"domain":"safetrust.example"')
    expect(payload.challenge).toContain('"network":"testnet"')
    expect(payload.challenge).toContain(`"walletAddress":"${ADDRESS}"`)
    expect(query).toHaveBeenCalledWith('DELETE FROM safetrust.wallet_challenges WHERE expires_at <= NOW()')
    expect(query.mock.calls[1][0]).toContain('INSERT INTO safetrust.wallet_challenges')
  })

  it('atomically consumes a valid challenge and creates the wallet association', async () => {
    const challenge = {
      user_id: 'user-1', wallet_address: ADDRESS, tenant_id: 'safetrust',
      domain: 'safetrust.example', network: 'testnet', nonce: 'n'.repeat(64),
      expires_at: new Date(Date.now() + 60_000),
    }
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM safetrust.wallet_challenges')) return { rows: [challenge] }
      if (sql.includes('FROM safetrust.user_wallets')) return { rows: [] }
      return { rows: [] }
    })
    ;(connect as jest.Mock).mockResolvedValue(makeClient(query))
    const res = makeResponse()

    await verifyWalletChallengeHandler(makeRequest({ challengeId: 'challenge-1', signature: 'a'.repeat(128) }) as never, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining([
      'BEGIN',
      expect.stringContaining('INSERT INTO safetrust.user_wallets'),
      expect.stringContaining('DELETE FROM safetrust.wallet_challenges'),
      'COMMIT',
    ]))
  })

  it('rejects reassignment without changing the existing owner', async () => {
    const challenge = {
      user_id: 'user-2', wallet_address: ADDRESS, tenant_id: 'safetrust',
      domain: 'safetrust.example', network: 'testnet', nonce: 'n'.repeat(64),
      expires_at: new Date(Date.now() + 60_000),
    }
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM safetrust.wallet_challenges')) return { rows: [challenge] }
      if (sql.includes('FROM safetrust.user_wallets')) return { rows: [{ user_id: 'user-1' }] }
      return { rows: [] }
    })
    ;(connect as jest.Mock).mockResolvedValue(makeClient(query))
    const res = makeResponse()

    await verifyWalletChallengeHandler(makeRequest({ challengeId: 'challenge-1', signature: 'a'.repeat(128) }, 'user-2') as never, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'WALLET_ALREADY_REGISTERED' })
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO safetrust.user_wallets'))).toBe(false)
    expect(query).toHaveBeenCalledWith('COMMIT')
  })
})
