import { createHash } from 'node:crypto'
import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { listWallets } from '../../../repositories/wallet.repository'
import { makeWalletPrimary, unlinkUserWallet } from '../../../services/wallet.service'
import {
  listWalletsHandler,
  unlinkWalletHandler,
  setPrimaryWalletHandler,
} from '../wallets.handler'
import { runHandler } from '../../__tests__/run-handler'

jest.mock('../../../repositories/wallet.repository', () => ({ listWallets: jest.fn() }))
jest.mock('../../../services/wallet.service', () => ({
  makeWalletPrimary: jest.fn(),
  unlinkUserWallet: jest.fn(),
}))

const WALLET_1 = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57'
const WALLET_2 = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  res.end = jest.fn().mockReturnValue(res)
  return res as Response
}

function makeRequest(
  params: Record<string, string> = {},
  uid = 'user-1'
): AuthenticatedRequest {
  return { user: { uid, role: 'tenant', roles: ['tenant'] }, params, body: {} } as unknown as AuthenticatedRequest
}

const walletRows = [
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

describe('wallets handlers', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when listing wallets without authentication', async () => {
    const res = makeResponse()
    await runHandler(listWalletsHandler, { user: undefined } as AuthenticatedRequest, res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'UNAUTHORIZED' }))
  })

  it('returns mapped wallets and resolves the stellar sign-in wallet', async () => {
    const uid = `stellar_${createHash('sha256').update(WALLET_1).digest('hex')}`
    ;(listWallets as jest.Mock).mockResolvedValue(walletRows)
    const res = makeResponse()

    await runHandler(listWalletsHandler, makeRequest({}, uid), res)

    expect(listWallets).toHaveBeenCalledWith(uid)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      wallets: [
        { address: WALLET_1, chain: 'STELLAR', isPrimary: true, createdAt: '2026-01-01T00:00:00.000Z' },
        { address: WALLET_2, chain: 'STELLAR', isPrimary: false, createdAt: '2026-01-02T00:00:00.000Z' },
      ],
      signInWallet: WALLET_1,
    })
  })

  it('rejects invalid addresses and the sign-in wallet before unlinking', async () => {
    const invalid = makeResponse()
    await runHandler(unlinkWalletHandler, makeRequest({ address: 'invalid' }), invalid)
    expect(invalid.status).toHaveBeenCalledWith(400)

    const uid = `stellar_${createHash('sha256').update(WALLET_1).digest('hex')}`
    const signIn = makeResponse()
    await runHandler(unlinkWalletHandler, makeRequest({ address: WALLET_1 }, uid), signIn)
    expect(signIn.status).toHaveBeenCalledWith(409)
    expect(signIn.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'WALLET_IS_SIGN_IN_METHOD' }))
    expect(unlinkUserWallet).not.toHaveBeenCalled()
  })

  it('returns 404 when the wallet is not owned by the user', async () => {
    ;(unlinkUserWallet as jest.Mock).mockResolvedValue('not-found')
    const res = makeResponse()
    await runHandler(unlinkWalletHandler, makeRequest({ address: WALLET_2 }), res)
    expect(unlinkUserWallet).toHaveBeenCalledWith('user-1', WALLET_2)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'WALLET_NOT_FOUND' }))
  })

  it('returns 204 when unlinking a wallet succeeds', async () => {
    ;(unlinkUserWallet as jest.Mock).mockResolvedValue('unlinked')
    const res = makeResponse()
    await runHandler(unlinkWalletHandler, makeRequest({ address: WALLET_2 }), res)
    expect(res.status).toHaveBeenCalledWith(204)
    expect(res.end).toHaveBeenCalled()
  })

  it('sets the primary wallet and returns the mapped wallet list', async () => {
    ;(makeWalletPrimary as jest.Mock).mockResolvedValue({ kind: 'updated', wallets: walletRows })
    const res = makeResponse()

    await runHandler(setPrimaryWalletHandler, makeRequest({ address: WALLET_2 }), res)

    expect(makeWalletPrimary).toHaveBeenCalledWith('user-1', WALLET_2)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      wallets: [
        { address: WALLET_1, chain: 'STELLAR', isPrimary: true, createdAt: '2026-01-01T00:00:00.000Z' },
        { address: WALLET_2, chain: 'STELLAR', isPrimary: false, createdAt: '2026-01-02T00:00:00.000Z' },
      ],
      signInWallet: null,
    })
  })

  it('returns 404 when the requested primary wallet is not owned by the user', async () => {
    ;(makeWalletPrimary as jest.Mock).mockResolvedValue({ kind: 'not-found' })
    const res = makeResponse()
    await runHandler(setPrimaryWalletHandler, makeRequest({ address: WALLET_2 }), res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'WALLET_NOT_FOUND' }))
  })
})
