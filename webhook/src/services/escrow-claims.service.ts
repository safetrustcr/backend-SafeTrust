import { pool } from '../db/pool'
import {
  CLAIM_RATE_LIMIT,
  countRecent,
  EscrowClaimRow,
  findByOpId,
  findParticipation,
  insert,
  lockClaimScope,
} from '../repositories/escrow-claims.repository'

export type CreateClaimResult =
  | { kind: 'not-participant' }
  | { kind: 'already-used'; claim: EscrowClaimRow }
  | { kind: 'not-released' }
  | { kind: 'rate-limited' }
  | { kind: 'created'; claim: EscrowClaimRow }
  | { kind: 'conflict-without-row' }

export async function createEscrowClaim(input: {
  escrowId: string
  authorId: string
  body: string
  clientOpId: string
}): Promise<CreateClaimResult> {
  const client = await pool.connect()
  let transactionOpen = false
  let releaseError: Error | undefined
  try {
    await client.query('BEGIN')
    transactionOpen = true
    await lockClaimScope(client, input.authorId, input.escrowId)

    const participation = await findParticipation(client, input.escrowId, input.authorId, true)
    if (!participation) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return { kind: 'not-participant' }
    }

    const existing = await findByOpId(client, input.authorId, input.clientOpId)
    if (existing) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return { kind: 'already-used', claim: existing }
    }

    if (participation.status !== 'completed') {
      await client.query('ROLLBACK')
      transactionOpen = false
      return { kind: 'not-released' }
    }
    if (await countRecent(client, input.authorId, input.escrowId) >= CLAIM_RATE_LIMIT) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return { kind: 'rate-limited' }
    }

    const created = await insert(client, {
      escrowId: input.escrowId,
      reservationId: participation.reservationId,
      authorId: input.authorId,
      body: input.body,
      clientOpId: input.clientOpId,
    })
    if (!created) {
      const raced = await findByOpId(client, input.authorId, input.clientOpId)
      await client.query('ROLLBACK')
      transactionOpen = false
      return raced
        ? { kind: 'already-used', claim: raced }
        : { kind: 'conflict-without-row' }
    }

    await client.query('COMMIT')
    transactionOpen = false
    return { kind: 'created', claim: created }
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        releaseError = rollbackError as Error
      }
    }
    throw error
  } finally {
    client.release(releaseError)
  }
}
