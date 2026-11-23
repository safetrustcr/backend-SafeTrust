import { pool } from '../db'
import { findUserByUid } from '../../repositories/user.repository'
import {
  createBidRequest as insertBidRequest,
  findBidForUpdate,
  hasActiveBid,
  updateBidStatus,
} from '../../repositories/bid-request.repository'
import { createBidRequest, updateBidRequest } from '../bid-request.service'

jest.mock('../db', () => ({ pool: { connect: jest.fn() } }))
jest.mock('../../repositories/user.repository', () => ({ findUserByUid: jest.fn() }))
jest.mock('../../repositories/bid-request.repository', () => ({
  createBidRequest: jest.fn(),
  findBidForUpdate: jest.fn(),
  hasActiveBid: jest.fn(),
  updateBidStatus: jest.fn(),
}))

describe('bid request services', () => {
  let client: { query: jest.Mock; release: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() }
    ;(pool.connect as jest.Mock).mockResolvedValue(client)
    ;(findUserByUid as jest.Mock).mockResolvedValue({ id: 'owner-1' })
    ;(hasActiveBid as jest.Mock).mockResolvedValue(false)
  })

  it('creates a bid unless an active one exists and maps the concurrent trigger', async () => {
    const bid = { id: 'bid-1', current_status: 'PENDING' }
    ;(insertBidRequest as jest.Mock).mockResolvedValue(bid)
    const created = await createBidRequest({
      apartmentId: 'apartment-1', uid: 'user-1', price: 100, desiredMoveIn: '2026-09-01',
    })
    expect(created).toEqual({ kind: 'created', bid })

    ;(hasActiveBid as jest.Mock).mockResolvedValueOnce(true)
    expect(await createBidRequest({
      apartmentId: 'apartment-1', uid: 'user-1', price: 100, desiredMoveIn: '2026-09-01',
    })).toEqual({ kind: 'duplicate' })

    ;(insertBidRequest as jest.Mock).mockRejectedValueOnce(
      new Error('Tenant already has an active bid on file')
    )
    expect(await createBidRequest({
      apartmentId: 'apartment-1', uid: 'user-1', price: 100, desiredMoveIn: '2026-09-01',
    })).toEqual({ kind: 'duplicate' })
  })

  it('rolls back when the caller has no synchronized user profile', async () => {
    ;(findUserByUid as jest.Mock).mockResolvedValue(null)
    const result = await updateBidRequest('missing-user', 'bid-1', 'APPROVED')
    expect(result).toEqual({ kind: 'profile-missing' })
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(findBidForUpdate).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalled()
  })

  it('enforces valid status transitions before updating the bid', async () => {
    ;(findBidForUpdate as jest.Mock).mockResolvedValue({
      id: 'bid-1', owner_id: 'owner-1', current_status: 'PENDING',
    })
    const result = await updateBidRequest('owner-1', 'bid-1', 'CONFIRMED')
    expect(result).toEqual({
      kind: 'invalid-transition',
      allowedTransitions: ['APPROVED', 'CANCELLED'],
    })
    expect(updateBidStatus).not.toHaveBeenCalled()
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('commits a valid owner transition and writes its history through the repository', async () => {
    const updated = { id: 'bid-1', current_status: 'APPROVED' }
    ;(findBidForUpdate as jest.Mock).mockResolvedValue({
      id: 'bid-1', owner_id: 'owner-1', current_status: 'PENDING',
    })
    ;(updateBidStatus as jest.Mock).mockResolvedValue(updated)

    const result = await updateBidRequest('owner-1', 'bid-1', 'APPROVED')
    expect(result).toEqual({ kind: 'updated', bid: updated })
    expect(updateBidStatus).toHaveBeenCalledWith(client, 'bid-1', 'APPROVED', 'owner-1')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalled()
  })
})
