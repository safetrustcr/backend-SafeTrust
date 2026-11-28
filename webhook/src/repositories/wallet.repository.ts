import type { PoolClient, QueryResultRow } from 'pg'
import type { ChainType } from '../domain'
import { connect, query } from '../services/db'

export interface WalletRow extends QueryResultRow {
  wallet_address: string
  chain_type: string
  is_primary: boolean
  created_at: Date | string
}

export interface WalletChallengeRow extends QueryResultRow {
  user_id: string
  wallet_address: string
  tenant_id: string
  domain: string
  network: string
  nonce: string
  expires_at: Date | string
}

export async function listWallets(uid: string): Promise<WalletRow[]> {
  const result = await query<WalletRow>(
    `SELECT wallet_address, chain_type, is_primary, created_at
     FROM safetrust.user_wallets WHERE user_id = $1
     ORDER BY is_primary DESC, created_at ASC`,
    [uid]
  )
  return result.rows
}

export async function createWalletChallenge(input: {
  challengeId: string
  uid: string
  address: string
  tenantId: string
  domain: string
  network: string
  nonce: string
  expiresAt: string
}): Promise<void> {
  const client = await connect()
  try {
    await client.query('DELETE FROM safetrust.wallet_challenges WHERE expires_at <= NOW()')
    await client.query(
      `INSERT INTO safetrust.wallet_challenges
        (challenge_id, user_id, wallet_address, tenant_id, domain, network, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.challengeId,
        input.uid,
        input.address,
        input.tenantId,
        input.domain,
        input.network,
        input.nonce,
        input.expiresAt,
      ]
    )
  } finally {
    client.release()
  }
}

export async function findWalletChallenge(
  client: PoolClient,
  challengeId: string
): Promise<WalletChallengeRow | null> {
  const result = await client.query<WalletChallengeRow>(
    `SELECT user_id, wallet_address, tenant_id, domain, network, nonce, expires_at
     FROM safetrust.wallet_challenges WHERE challenge_id = $1 FOR UPDATE`,
    [challengeId]
  )
  return result.rows[0] ?? null
}

export async function deleteWalletChallenge(client: PoolClient, challengeId: string): Promise<void> {
  await client.query('DELETE FROM safetrust.wallet_challenges WHERE challenge_id = $1', [challengeId])
}

export async function findWalletOwner(
  client: PoolClient,
  address: string
): Promise<{ user_id: string } | null> {
  const result = await client.query<{ user_id: string }>(
    'SELECT user_id FROM safetrust.user_wallets WHERE wallet_address = $1 FOR UPDATE',
    [address]
  )
  return result.rows[0] ?? null
}

export async function insertVerifiedWallet(
  client: PoolClient,
  uid: string,
  address: string,
  isPrimary: boolean
): Promise<void> {
  await client.query(
    `INSERT INTO safetrust.user_wallets (user_id, wallet_address, chain_type, is_primary)
     VALUES ($1, $2, 'STELLAR', $3)`,
    [uid, address, isPrimary]
  )
}

export async function unlinkWallet(
  client: PoolClient,
  uid: string,
  address: string
): Promise<boolean | null> {
  const result = await client.query<{ is_primary: boolean }>(
    `DELETE FROM safetrust.user_wallets
     WHERE user_id = $1 AND wallet_address = $2
     RETURNING is_primary`,
    [uid, address]
  )
  return result.rows[0]?.is_primary ?? (result.rowCount === 0 ? null : false)
}

export async function promoteOldestWallet(client: PoolClient, uid: string): Promise<void> {
  await client.query(
    `UPDATE safetrust.user_wallets SET is_primary = true, updated_at = NOW()
     WHERE id = (
       SELECT id FROM safetrust.user_wallets
       WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1
     )`,
    [uid]
  )
}

export async function lockUserWallets(client: PoolClient, uid: string): Promise<void> {
  await client.query(
    'SELECT id FROM safetrust.user_wallets WHERE user_id = $1 ORDER BY id FOR UPDATE',
    [uid]
  )
}

export async function findWalletForUser(
  client: PoolClient,
  uid: string,
  address: string
): Promise<{ id: string; is_primary: boolean } | null> {
  const result = await client.query<{ id: string; is_primary: boolean }>(
    `SELECT id, is_primary FROM safetrust.user_wallets
     WHERE user_id = $1 AND wallet_address = $2 FOR UPDATE`,
    [uid, address]
  )
  return result.rows[0] ?? null
}

export async function clearPrimaryWallets(client: PoolClient, uid: string): Promise<void> {
  await client.query(
    `UPDATE safetrust.user_wallets SET is_primary = false, updated_at = NOW()
     WHERE user_id = $1 AND is_primary = true`,
    [uid]
  )
}

export async function setPrimaryWallet(
  client: PoolClient,
  uid: string,
  address: string
): Promise<void> {
  await client.query(
    `UPDATE safetrust.user_wallets SET is_primary = true, updated_at = NOW()
     WHERE user_id = $1 AND wallet_address = $2`,
    [uid, address]
  )
}

export async function listWalletsForUpdate(client: PoolClient, uid: string): Promise<WalletRow[]> {
  const result = await client.query<WalletRow>(
    `SELECT wallet_address, chain_type, is_primary, created_at
     FROM safetrust.user_wallets WHERE user_id = $1
     ORDER BY is_primary DESC, created_at ASC`,
    [uid]
  )
  return result.rows
}

export async function syncWallet(input: {
  uid: string
  address: string
  chainType: ChainType
  isPrimary: boolean
}): Promise<{ wallet_address: string } | null> {
  const result = await query<{ wallet_address: string }>(
    `INSERT INTO safetrust.user_wallets (user_id, wallet_address, chain_type, is_primary)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (wallet_address)
     DO UPDATE SET
       chain_type = EXCLUDED.chain_type,
       is_primary = EXCLUDED.is_primary,
       updated_at = NOW()
     WHERE safetrust.user_wallets.user_id = EXCLUDED.user_id
     RETURNING id, wallet_address, chain_type, is_primary`,
    [input.uid, input.address, input.chainType, input.isPrimary]
  )
  return result.rows[0] ?? null
}
