import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { createWalletChallengeHandler, verifyWalletChallengeHandler } from '../wallet-challenge.handler'
import { createWalletChallenge } from '../../../repositories/wallet.repository'
import { verifyWalletChallenge } from '../../../services/wallet.service'

jest.mock('../../../repositories/wallet.repository', () => ({ createWalletChallenge: jest.fn() }))
jest.mock('../../../services/wallet.service', () => ({ verifyWalletChallenge: jest.fn() }))

/** Account of the fixed seed `[7u8; 32]` used by the former Rust stellar-utils tests. */
const ADDRESS = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57'

/**
 * A challenge and the signature the Rust crate (ed25519-dalek, seed
 * `[7u8; 32]`) produced over the message this handler builds from it.
 */
const SIGNED_CHALLENGE = {
  input: {
    uid: 'user-1',
    walletAddress: ADDRESS,
    tenant: 'safetrust',
    domain: 'safetrust.example',
    network: 'testnet',
    nonce: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
    expiresAt: '2026-01-01T00:05:00.000Z',
  },
  signature:
    'e8988f10271c875822e0df4dc6a86846e682378a8295558e3795bb35bfbb3ff29433c3ffcb5c17853208834f9500d8f7f917be1f128498be60342f7b861cfa0e',
}

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

function makeRequest(body: Record<string, unknown>, uid = 'user-1'): AuthenticatedRequest {
  return { user: { uid }, body } as AuthenticatedRequest
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

    await createWalletChallengeHandler(makeRequest({ wallet_address: ADDRESS }) as never, res)

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

    await verifyWalletChallengeHandler(makeRequest({ challengeId: 'challenge-1', signature: 'a'.repeat(128) }) as never, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ success: true, wallet_address: ADDRESS })
    expect(verifyWalletChallenge).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'user-1',
      challengeId: 'challenge-1',
      signature: 'a'.repeat(128),
      context: { tenant: 'safetrust', domain: 'safetrust.example', network: 'testnet' },
    }))
  })

  it('verifies the Rust test-vector signature over the challenge message it builds', async () => {
    ;(verifyWalletChallenge as jest.Mock).mockResolvedValue({ kind: 'verified', address: ADDRESS })
    const res = makeResponse()

    await verifyWalletChallengeHandler(
      makeRequest({ challengeId: 'challenge-1', signature: SIGNED_CHALLENGE.signature }) as never,
      res
    )

    const { verifySignature, makeMessage } = (verifyWalletChallenge as jest.Mock).mock.calls[0][0]
    const message = makeMessage(SIGNED_CHALLENGE.input)
    expect(verifySignature(message, SIGNED_CHALLENGE.signature, ADDRESS)).toBe(true)
    // Any change to the signed message, signer or signature fails.
    expect(verifySignature(makeMessage({ ...SIGNED_CHALLENGE.input, uid: 'user-2' }), SIGNED_CHALLENGE.signature, ADDRESS)).toBe(false)
    expect(verifySignature(message, SIGNED_CHALLENGE.signature, 'GD6ROJBYLKQMOW3E7N4M2YBPUHMZD7PL65VRHRMO24BOVSBV5H3BQRSL')).toBe(false)
    expect(verifySignature(message, 'a'.repeat(128), ADDRESS)).toBe(false)
  })

  it('rejects a contract address and a bad-checksum address when issuing a challenge', async () => {
    const contractRes = makeResponse()
    await createWalletChallengeHandler(
      makeRequest({ wallet_address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4' }) as never,
      contractRes
    )
    expect(contractRes.status).toHaveBeenCalledWith(400)
    expect(contractRes.json).toHaveBeenCalledWith({ error: 'UNSUPPORTED_STELLAR_ACCOUNT_TYPE' })

    const badChecksumRes = makeResponse()
    await createWalletChallengeHandler(
      makeRequest({ wallet_address: 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z' }) as never,
      badChecksumRes
    )
    expect(badChecksumRes.status).toHaveBeenCalledWith(400)
    expect(badChecksumRes.json).toHaveBeenCalledWith({ error: 'INVALID_STELLAR_ACCOUNT' })
    expect(createWalletChallenge).not.toHaveBeenCalled()
  })

  it('rejects reassignment without changing the existing owner', async () => {
    ;(verifyWalletChallenge as jest.Mock).mockResolvedValue({ kind: 'already-registered' })
    const res = makeResponse()

    await verifyWalletChallengeHandler(makeRequest({ challengeId: 'challenge-1', signature: 'a'.repeat(128) }, 'user-2') as never, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'WALLET_ALREADY_REGISTERED' })
  })
})
