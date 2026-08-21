import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { syncWalletHandler } from '../sync-wallet.handler'
import db from '../../../services/db'

jest.mock('../../../services/db', () => ({
  query: jest.fn(),
}))

const VALID_STELLAR = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57'
const BAD_CHECKSUM_STELLAR = 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z'

let hasNativeAddon = false
try {
  require('../../../../../crates/stellar-utils')
  hasNativeAddon = true
} catch (err) {
  // Addon not built — JS fallback regex in use
}

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

function makeRequest(body: Record<string, unknown>, uid = 'user-1'): AuthenticatedRequest {
  return {
    user: { uid } as any,
    body,
  } as AuthenticatedRequest
}

describe('syncWalletHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 400 when wallet_address is missing', async () => {
    const req = makeRequest({ chain_type: 'STELLAR', is_primary: false })
    const res = makeResponse()

    await syncWalletHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'wallet_address is required' })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('returns 400 when chain_type is invalid', async () => {
    const req = makeRequest({
      wallet_address: VALID_STELLAR,
      chain_type: 'INVALID',
      is_primary: false,
    })
    const res = makeResponse()

    await syncWalletHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: 'chain_type must be one of: ETH, STELLAR, BSC',
    })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('returns 400 when is_primary is not a boolean', async () => {
    const req = makeRequest({
      wallet_address: VALID_STELLAR,
      chain_type: 'STELLAR',
      is_primary: 'yes',
    })
    const res = makeResponse()

    await syncWalletHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'is_primary must be a boolean' })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed Stellar address', async () => {
    const req = makeRequest({
      wallet_address: 'not-a-stellar-address',
      chain_type: 'STELLAR',
      is_primary: false,
    })
    const res = makeResponse()

    await syncWalletHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid Stellar wallet address' })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('accepts a valid Stellar address and upserts the wallet', async () => {
    ;(db.query as jest.Mock).mockResolvedValue({
      rows: [
        {
          id: 'wallet-1',
          wallet_address: VALID_STELLAR,
          chain_type: 'STELLAR',
          is_primary: true,
        },
      ],
    })

    const req = makeRequest({
      wallet_address: VALID_STELLAR,
      chain_type: 'STELLAR',
      is_primary: true,
    })
    const res = makeResponse()

    await syncWalletHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      wallet_address: VALID_STELLAR,
    })
    expect(db.query).toHaveBeenCalledTimes(1)
    expect((db.query as jest.Mock).mock.calls[0][1]).toEqual([
      'user-1',
      VALID_STELLAR,
      'STELLAR',
      true,
    ])
  })

  it('returns 500 when the database upsert fails', async () => {
    ;(db.query as jest.Mock).mockRejectedValue(new Error('connection refused'))

    const req = makeRequest({
      wallet_address: VALID_STELLAR,
      chain_type: 'STELLAR',
      is_primary: false,
    })
    const res = makeResponse()

    await syncWalletHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to sync wallet' })
  })

  const withNativeAddon = hasNativeAddon ? it : it.skip

  withNativeAddon('rejects a G-address with a bad SEP-23 checksum', async () => {
    const req = makeRequest({
      wallet_address: BAD_CHECKSUM_STELLAR,
      chain_type: 'STELLAR',
      is_primary: false,
    })
    const res = makeResponse()

    await syncWalletHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid Stellar wallet address' })
    expect(db.query).not.toHaveBeenCalled()
  })

  withNativeAddon('rejects a valid contract (C…) strkey, which is not an account', async () => {
    const req = makeRequest({
      wallet_address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
      chain_type: 'STELLAR',
      is_primary: false,
    })
    const res = makeResponse()

    await syncWalletHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid Stellar wallet address' })
  })
})
