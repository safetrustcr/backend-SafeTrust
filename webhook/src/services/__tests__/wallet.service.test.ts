import { pool } from '../db'
import {
  clearPrimaryWallets,
  deleteWalletChallenge,
  findWalletChallenge,
  findWalletForUser,
  findWalletOwner,
  insertVerifiedWallet,
  listWalletsForUpdate,
  promoteOldestWallet,
  setPrimaryWallet,
  unlinkWallet,
} from '../../repositories/wallet.repository'
import { makeWalletPrimary, unlinkUserWallet, verifyWalletChallenge } from '../wallet.service'

jest.mock('../db', () => ({ pool: { connect: jest.fn() } }))
jest.mock('../../repositories/wallet.repository', () => ({
  clearPrimaryWallets: jest.fn(),
  deleteWalletChallenge: jest.fn(),
  findWalletChallenge: jest.fn(),
  findWalletForUser: jest.fn(),
  findWalletOwner: jest.fn(),
  insertVerifiedWallet: jest.fn(),
  listWalletsForUpdate: jest.fn(),
  lockUserWallets: jest.fn(),
  promoteOldestWallet: jest.fn(),
  setPrimaryWallet: jest.fn(),
  unlinkWallet: jest.fn(),
}))

describe('wallet service', () => {
  let client: { query: jest.Mock; release: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() }
    ;(pool.connect as jest.Mock).mockResolvedValue(client)
  })

  it('deletes expired challenges and commits their consumption', async () => {
    ;(findWalletChallenge as jest.Mock).mockResolvedValue({
      user_id: 'user-1',
      wallet_address: 'G'.repeat(56),
      tenant_id: 'safetrust',
      domain: 'example.test',
      network: 'testnet',
      nonce: 'n'.repeat(64),
      expires_at: new Date(Date.now() - 1),
    })

    const result = await verifyWalletChallenge({
      uid: 'user-1',
      challengeId: 'challenge-1',
      signature: 's'.repeat(128),
      isPrimary: false,
      context: { tenant: 'safetrust', domain: 'example.test', network: 'testnet' },
      verifySignature: () => true,
      makeMessage: () => 'message',
    })

    expect(result).toEqual({ kind: 'expired' })
    expect(findWalletChallenge).toHaveBeenCalledWith(client, 'challenge-1', 'safetrust')
    expect(deleteWalletChallenge).toHaveBeenCalledWith(client, 'challenge-1', 'safetrust')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalled()
    expect(findWalletOwner).not.toHaveBeenCalled()
  })

  it('commits verified wallet registration and returns the wallet list for primary changes', async () => {
    const expiresAt = new Date(Date.now() + 60_000)
    ;(findWalletChallenge as jest.Mock).mockResolvedValue({
      user_id: 'user-1',
      wallet_address: 'G'.repeat(56),
      tenant_id: 'safetrust',
      domain: 'example.test',
      network: 'testnet',
      nonce: 'n'.repeat(64),
      expires_at: expiresAt,
    })
    ;(findWalletOwner as jest.Mock).mockResolvedValue(null)
    const verified = await verifyWalletChallenge({
      uid: 'user-1',
      challengeId: 'challenge-1',
      signature: 's'.repeat(128),
      isPrimary: true,
      context: { tenant: 'safetrust', domain: 'example.test', network: 'testnet' },
      verifySignature: () => true,
      makeMessage: () => 'message',
    })

    expect(verified).toEqual({ kind: 'verified', address: 'G'.repeat(56) })
    expect(insertVerifiedWallet).toHaveBeenCalledWith(client, 'user-1', 'G'.repeat(56), true)
    expect(client.query).toHaveBeenCalledWith('COMMIT')

    const wallets = [{ wallet_address: 'G'.repeat(56), chain_type: 'STELLAR', is_primary: true, created_at: expiresAt }]
    ;(findWalletForUser as jest.Mock).mockResolvedValue({ id: 'wallet-1', is_primary: true })
    ;(listWalletsForUpdate as jest.Mock).mockResolvedValue(wallets)
    const changed = await makeWalletPrimary('user-1', 'G'.repeat(56))
    expect(changed).toEqual({ kind: 'updated', wallets })
    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(2)
  })

  it('rolls back a primary-wallet change when the wallet is not owned', async () => {
    ;(findWalletForUser as jest.Mock).mockResolvedValue(null)

    const result = await makeWalletPrimary('user-1', 'wallet-2')
    expect(result).toEqual({ kind: 'not-found' })
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('clears the previous primary and promotes the selected wallet atomically', async () => {
    ;(findWalletForUser as jest.Mock).mockResolvedValue({ id: 'wallet-2', is_primary: false })
    ;(listWalletsForUpdate as jest.Mock).mockResolvedValue([])

    await makeWalletPrimary('user-1', 'wallet-2')

    expect(clearPrimaryWallets).toHaveBeenCalledWith(client, 'user-1')
    expect(setPrimaryWallet).toHaveBeenCalledWith(client, 'user-1', 'wallet-2')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })

  it('promotes the oldest wallet only when unlinking the current primary', async () => {
    ;(unlinkWallet as jest.Mock).mockResolvedValue(true)
    await expect(unlinkUserWallet('user-1', 'wallet-1')).resolves.toBe('unlinked')
    expect(promoteOldestWallet).toHaveBeenCalledWith(client, 'user-1')

    jest.clearAllMocks()
    ;(pool.connect as jest.Mock).mockResolvedValue(client)
    ;(unlinkWallet as jest.Mock).mockResolvedValue(false)
    await expect(unlinkUserWallet('user-1', 'wallet-2')).resolves.toBe('unlinked')
    expect(promoteOldestWallet).not.toHaveBeenCalled()
  })
})
