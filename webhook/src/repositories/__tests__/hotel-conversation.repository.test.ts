import { PoolClient } from 'pg'
import {
  insertHotelMessage,
  upsertHotelConversation,
} from '../hotel-conversation.repository'

function makeClient(rows: unknown[]): { client: PoolClient; query: jest.Mock } {
  const query = jest.fn().mockResolvedValue({ rows })
  return { client: { query } as unknown as PoolClient, query }
}

describe('hotel-conversation.repository', () => {
  describe('upsertHotelConversation', () => {
    it('creates idempotently on the unique conversation constraint', async () => {
      const { client, query } = makeClient([{ id: 'conv-1' }])

      await upsertHotelConversation(client, {
        reservationId: 'res-1',
        hostId: 'host-1',
        guestId: 'guest-1',
      })

      const [sql] = query.mock.calls[0]
      expect(sql).toMatch(/INSERT INTO hotel_industry\.conversations/)
      expect(sql).toMatch(/ON CONFLICT ON CONSTRAINT unique_hotel_conversation/)
      expect(sql).toMatch(/RETURNING id/)
      expect(sql).not.toMatch(/^\s*SELECT/i)
    })

    it('writes the NOT NULL host and guest columns', async () => {
      const { client, query } = makeClient([{ id: 'conv-1' }])

      await upsertHotelConversation(client, {
        reservationId: 'res-1',
        hostId: 'host-1',
        guestId: 'guest-1',
        escrowTransactionId: 'et-1',
      })

      const [sql, params] = query.mock.calls[0]
      expect(sql).toMatch(/\(reservation_id, host_id, guest_id, escrow_transaction_id, status\)/)
      expect(params).toEqual(['res-1', 'host-1', 'guest-1', 'et-1'])
    })

    it('returns the id on both the insert and the conflict path', async () => {
      const { client } = makeClient([{ id: 'existing-conv' }])

      await expect(
        upsertHotelConversation(client, {
          reservationId: 'res-1',
          hostId: 'host-1',
          guestId: 'guest-1',
        })
      ).resolves.toBe('existing-conv')
    })

    it('never overwrites an existing escrow link on conflict', async () => {
      const { client, query } = makeClient([{ id: 'conv-1' }])

      await upsertHotelConversation(client, {
        reservationId: 'res-1',
        hostId: 'host-1',
        guestId: 'guest-1',
        escrowTransactionId: 'et-2',
      })

      const [sql] = query.mock.calls[0]
      expect(sql).toMatch(
        /COALESCE\(\s*hotel_industry\.conversations\.escrow_transaction_id,\s*EXCLUDED\.escrow_transaction_id\s*\)/
      )
    })

    it('passes a null escrow link when none is given', async () => {
      const { client, query } = makeClient([{ id: 'conv-1' }])

      await upsertHotelConversation(client, {
        reservationId: 'res-1',
        hostId: 'host-1',
        guestId: 'guest-1',
      })

      expect(query.mock.calls[0][1][3]).toBeNull()
    })
  })

  describe('insertHotelMessage', () => {
    it('inserts the message and returns the stored row', async () => {
      const row = {
        id: 'msg-1',
        conversation_id: 'conv-1',
        body: 'hello',
        is_automated: true,
        event_type: 'escrow_funded',
        created_at: '2026-11-14T00:00:00Z',
      }
      const { client, query } = makeClient([row])

      const result = await insertHotelMessage(client, {
        conversationId: 'conv-1',
        senderId: 'guest-1',
        body: 'hello',
        isAutomated: true,
        eventType: 'escrow_funded',
      })

      expect(result).toEqual(row)
      const [sql, params] = query.mock.calls[0]
      expect(sql).toMatch(/INSERT INTO hotel_industry\.messages/)
      expect(params).toEqual(['conv-1', 'guest-1', 'hello', true, 'escrow_funded'])
    })
  })
})
