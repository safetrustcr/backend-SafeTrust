import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { createWalletChallengeHandler, verifyWalletChallengeHandler } from '../wallet-challenge.handler'
import { runHandler } from '../../__tests__/run-handler'
import { createWalletChallenge } from '../../../repositories/wallet.repository'
import { verifyWalletChallenge } from '../../../services/wallet.service'

jest.mock('../../../repositories/wallet.repository', () => ({ createWalletChallenge: jest.fn() }))
jest.mock('../../../services/wallet.service', () => ({ verifyWalletChallenge: jest.fn() }))
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
  return {
    user: { uid },
    context: { uid, tenantId: 'safetrust', roles: ['guest'] },
    body,
  } as AuthenticatedRequest
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
    const res = makeResponse()

    await runHandler(createWalletChallengeHandler, makeRequest({ wallet_address: ADDRESS }) as never, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const payload = (res.json as jest.Mock).mock.calls[0][0]
    expect(payload.challenge).toContain('"uid":"user-1"')
    expect(payload.challenge).toContain('"tenant":"safetrust"')
    expect(payload.challenge).toContain('"domain":"safetrust.example"')
    expect(payload.challenge).toContain('"network":"testnet"')
    expect(payload.challenge).toContain(`"walletAddress":"${ADDRESS}"`)
    expect(createWalletChallenge).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'user-1',
      address: ADDRESS,
      tenantId: 'safetrust',
      domain: 'safetrust.example',
      network: 'testnet',
    }))
  })

  it('atomically consumes a valid challenge and creates the wallet association', async () => {
    ;(verifyWalletChallenge as jest.Mock).mockResolvedValue({ kind: 'verified', address: ADDRESS })
    const res = makeResponse()

    await runHandler(verifyWalletChallengeHandler, makeRequest({ challengeId: 'challenge-1', signature: 'a'.repeat(128) }) as never, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ success: true, wallet_address: ADDRESS })
    expect(verifyWalletChallenge).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'user-1',
      challengeId: 'challenge-1',
      signature: 'a'.repeat(128),
      context: { tenant: 'safetrust', domain: 'safetrust.example', network: 'testnet' },
    }))
  })

  it('rejects reassignment without changing the existing owner', async () => {
    ;(verifyWalletChallenge as jest.Mock).mockResolvedValue({ kind: 'already-registered' })
    const res = makeResponse()

    await runHandler(verifyWalletChallengeHandler, makeRequest({ challengeId: 'challenge-1', signature: 'a'.repeat(128) }, 'user-2') as never, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'WALLET_ALREADY_REGISTERED' }))
  })
})
