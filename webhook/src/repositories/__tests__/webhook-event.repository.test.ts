import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
  processWebhookEvent,
} from '../webhook-event.repository'
import { pool } from '../../services/db'

jest.mock('../../services/db', () => ({
  pool: {
    connect: jest.fn(),
    query: jest.fn(),
  },
}))

describe('webhook-event.repository', () => {
  let mockClient: {
    query: jest.Mock
    release: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    }
    ;(pool.connect as jest.Mock).mockResolvedValue(mockClient)
  })

  it('atomically claims a new event using its logical identity', async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'evt-100' }] })
      .mockResolvedValueOnce({})

    const result = await logAndCheckWebhookEvent(
      'contract-1',
      'escrow.funded',
      { amount: 100 }
    )

    expect(mockClient.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('ON CONFLICT (tenant_id, event_identity) DO NOTHING'),
      [
        'contract-1',
        'escrow.funded',
        expect.any(String),
        JSON.stringify({ amount: 100 }),
        'safetrust',
      ]
    )
    expect(mockClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.anything()
    )
    expect(result).toEqual({ isDuplicate: false, eventId: 'evt-100' })
    expect(mockClient.query).toHaveBeenLastCalledWith('COMMIT')
    expect(mockClient.release).toHaveBeenCalledTimes(1)
  })

  it('returns the existing event when the unique identity is already claimed', async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'evt-existing' }] })
      .mockResolvedValueOnce({})

    const result = await logAndCheckWebhookEvent(
      'contract-1',
      'escrow.funded',
      { amount: 100 }
    )

    expect(result).toEqual({ isDuplicate: true, eventId: 'evt-existing' })
    expect(mockClient.query.mock.calls[1][0]).toContain('ON CONFLICT')
  })

  it('processes one state mutation for concurrent deliveries of the same event', async () => {
    const firstClient = {
      query: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'evt-claimed' }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}),
      release: jest.fn(),
    }
    const secondClient = {
      query: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'evt-claimed' }] })
        .mockResolvedValueOnce({}),
      release: jest.fn(),
    }
    ;(pool.connect as jest.Mock)
      .mockResolvedValueOnce(firstClient)
      .mockResolvedValueOnce(secondClient)

    const stateMutation = jest.fn().mockResolvedValue({ id: 'escrow-1' })
    const [first, second] = await Promise.all([
      processWebhookEvent('contract-1', 'escrow.funded', { eventId: 'evt-1' }, stateMutation),
      processWebhookEvent('contract-1', 'escrow.funded', { eventId: 'evt-1' }, stateMutation),
    ])

    expect(stateMutation).toHaveBeenCalledTimes(1)
    expect([first.isDuplicate, second.isDuplicate].sort()).toEqual([false, true])
    expect(firstClient.query).toHaveBeenCalledWith(
      expect.stringContaining('SET processed = true'),
      ['evt-claimed']
    )
  })

  it('rolls back a failed state transition so the delivery can be retried', async () => {
    const failedClient = {
      query: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'evt-retry' }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}),
      release: jest.fn(),
    }
    const retryClient = {
      query: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'evt-retry' }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}),
      release: jest.fn(),
    }
    ;(pool.connect as jest.Mock)
      .mockResolvedValueOnce(failedClient)
      .mockResolvedValueOnce(retryClient)

    await expect(
      processWebhookEvent('contract-1', 'escrow.funded', { eventId: 'evt-1' }, async () => {
        throw new Error('State update failed')
      })
    ).rejects.toThrow('State update failed')

    const result = await processWebhookEvent(
      'contract-1',
      'escrow.funded',
      { eventId: 'evt-1' },
      jest.fn().mockResolvedValue({ id: 'escrow-1' })
    )

    expect(failedClient.query).toHaveBeenCalledWith('ROLLBACK')
    expect(retryClient.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO'))).toHaveLength(1)
    expect(result).toMatchObject({ isDuplicate: false, eventId: 'evt-retry' })
  })

  it('uses different identities for same-type events with distinct payloads', async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'evt-0' }] })
      .mockResolvedValueOnce({})
    await logAndCheckWebhookEvent(
      'contract-1',
      'milestone.released',
      { transactionHash: 'tx-1', milestoneIndex: 0 }
    )
    const firstIdentity = mockClient.query.mock.calls[1][1][2]

    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'evt-1' }] })
      .mockResolvedValueOnce({})
    await logAndCheckWebhookEvent(
      'contract-1',
      'milestone.released',
      { transactionHash: 'tx-1', milestoneIndex: 1 }
    )
    const secondIdentity = mockClient.query.mock.calls[4][1][2]

    expect(firstIdentity).not.toBe(secondIdentity)
  })

  it('rolls back on query error', async () => {
    mockClient.query
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Insert error'))

    await expect(
      logAndCheckWebhookEvent('contract-1', 'escrow.funded', { amount: 100 })
    ).rejects.toThrow('Insert error')

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    expect(mockClient.release).toHaveBeenCalledTimes(1)
  })

  it('marks an event as processed', async () => {
    ;(pool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 })

    await markWebhookEventProcessed('evt-100')

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE safetrust.trustless_work_webhook_events'),
      ['evt-100', expect.any(Date)]
    )
  })
})
