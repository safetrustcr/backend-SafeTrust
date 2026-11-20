import { pool } from '../db'
import {
  countRecent,
  findByOpId,
  findParticipation,
  insert,
  lockClaimScope,
} from '../../repositories/escrow-claims.repository'
import { createEscrowClaim } from '../escrow-claims.service'

jest.mock('../db', () => ({ pool: { connect: jest.fn() } }))
jest.mock('../../repositories/escrow-claims.repository', () => ({
  CLAIM_RATE_LIMIT: 5,
  countRecent: jest.fn(),
  findByOpId: jest.fn(),
  findParticipation: jest.fn(),
  insert: jest.fn(),
  lockClaimScope: jest.fn(),
}))

const claim = {
  id: 'claim-1',
  escrow_id: 'escrow-1',
  reservation_id: 'reservation-1',
  author_id: 'user-1',
  body: 'claim text',
  status: 'submitted',
  client_op_id: 'operation-1',
  created_at: new Date(),
  updated_at: new Date(),
}

describe('createEscrowClaim service', () => {
  let client: { query: jest.Mock; release: jest.Mock }
  const input = {
    escrowId: 'escrow-1',
    authorId: 'user-1',
    body: 'claim text',
    clientOpId: 'operation-1',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() }
    ;(pool.connect as jest.Mock).mockResolvedValue(client)
    ;(findParticipation as jest.Mock).mockResolvedValue({
      reservationId: 'reservation-1', status: 'completed',
    })
    ;(findByOpId as jest.Mock).mockResolvedValue(null)
    ;(countRecent as jest.Mock).mockResolvedValue(0)
    ;(insert as jest.Mock).mockResolvedValue(claim)
  })

  it('creates a participant claim under the transaction lock', async () => {
    const result = await createEscrowClaim(input)
    expect(result).toEqual({ kind: 'created', claim })
    expect(lockClaimScope).toHaveBeenCalledWith(client, 'user-1', 'escrow-1')
    expect(insert).toHaveBeenCalledWith(client, {
      escrowId: 'escrow-1',
      reservationId: 'reservation-1',
      authorId: 'user-1',
      body: 'claim text',
      clientOpId: 'operation-1',
    })
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalled()
  })

  it('rolls back and returns the original claim for an idempotent retry', async () => {
    ;(findByOpId as jest.Mock).mockResolvedValue(claim)
    const result = await createEscrowClaim(input)
    expect(result).toEqual({ kind: 'already-used', claim })
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(insert).not.toHaveBeenCalled()
  })

  it('enforces participation release and rate limits before inserting', async () => {
    ;(findParticipation as jest.Mock).mockResolvedValue(null)
    await expect(createEscrowClaim(input)).resolves.toEqual({ kind: 'not-participant' })
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')

    jest.clearAllMocks()
    ;(pool.connect as jest.Mock).mockResolvedValue(client)
    ;(findParticipation as jest.Mock).mockResolvedValue({
      reservationId: 'reservation-1', status: 'completed',
    })
    ;(findByOpId as jest.Mock).mockResolvedValue(null)
    ;(countRecent as jest.Mock).mockResolvedValue(5)
    await expect(createEscrowClaim(input)).resolves.toEqual({ kind: 'rate-limited' })
    expect(insert).not.toHaveBeenCalled()
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
  })
})
