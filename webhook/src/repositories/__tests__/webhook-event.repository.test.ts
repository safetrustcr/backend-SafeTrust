import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
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

  describe('logAndCheckWebhookEvent', () => {
    it('logs new event and returns isDuplicate false (happy path)', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // advisory lock
        .mockResolvedValueOnce({ rows: [] }) // existing check (0 rows)
        .mockResolvedValueOnce({ rows: [{ id: 'evt-100' }] }) // insert returning id
        .mockResolvedValueOnce({}) // COMMIT

      const result = await logAndCheckWebhookEvent('contract-1', 'escrow.funded', { amount: 100 })

      expect(pool.connect).toHaveBeenCalledTimes(1)
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        ['safetrust:contract-1:escrow.funded']
      )
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(mockClient.release).toHaveBeenCalledTimes(1)
      expect(result).toEqual({
        isDuplicate: false,
        eventId: 'evt-100',
      })
    })

    it('detects duplicate event and returns isDuplicate true', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // advisory lock
        .mockResolvedValueOnce({ rows: [{ id: 'existing-evt-1' }] }) // existing check (found)
        .mockResolvedValueOnce({ rows: [{ id: 'evt-101' }] }) // insert returning id
        .mockResolvedValueOnce({}) // COMMIT

      const result = await logAndCheckWebhookEvent('contract-1', 'escrow.funded', { amount: 100 })

      expect(result).toEqual({
        isDuplicate: true,
        eventId: 'evt-101',
      })
      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })

    it('rolls back transaction on query error', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('Lock error')) // lock fails

      await expect(
        logAndCheckWebhookEvent('contract-1', 'escrow.funded', { amount: 100 })
      ).rejects.toThrow('Lock error')

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })
  })

  describe('markWebhookEventProcessed', () => {
    it('executes UPDATE query on pool', async () => {
      ;(pool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 })

      await markWebhookEventProcessed('evt-100')

      expect(pool.query).toHaveBeenCalledTimes(1)
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE public.trustless_work_webhook_events'),
        ['evt-100', expect.any(Date)]
      )
    })
  })
})
