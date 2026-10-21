'use strict'

const mockClient = {
  query:    jest.fn(),
  release:  jest.fn(),
}

jest.mock('../../services/db', () => ({
  pool: {
    connect: jest.fn(async () => mockClient),
  },
}))

import {
  recordHotelConversationMessage,
  upsertHotelConversation,
} from '../hotel-conversation.repository'

const conversation = {
  id:                    '44444444-4444-4444-8444-444444444444',
  reservation_id:        '11111111-1111-4111-8111-111111111111',
  host_id:               '22222222-2222-4222-8222-222222222222',
  guest_id:              '33333333-3333-4333-8333-333333333333',
  escrow_transaction_id: '66666666-6666-4666-8666-666666666666',
  status:                'active',
}

const message = {
  id:              '55555555-5555-4555-8555-555555555555',
  conversation_id: conversation.id,
  sender_id:       conversation.guest_id,
  body:            'SafeTrust: Your deposit has been confirmed.',
  is_automated:    true,
  event_type:      'escrow_funded',
  created_at:      '2026-10-21T00:00:00.000Z',
}

const upsertParams = {
  reservationId:        conversation.reservation_id,
  hostId:               conversation.host_id,
  guestId:              conversation.guest_id,
  escrowTransactionId:  conversation.escrow_transaction_id,
}

describe('hotel-conversation.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockClient.query.mockReset()
    mockClient.release.mockReset()
  })

  it('creates conversations with an ON CONFLICT upsert on the unique constraint', async () => {
    mockClient.query
      .mockResolvedValueOnce({})                    // BEGIN
      .mockResolvedValueOnce({})                    // SET LOCAL statement_timeout
      .mockResolvedValueOnce({ rows: [conversation] }) // INSERT ... ON CONFLICT
      .mockResolvedValueOnce({})                    // COMMIT

    const result = await upsertHotelConversation(upsertParams, 1500)

    expect(result).toEqual(conversation)

    const sql = mockClient.query.mock.calls[2][0] as string
    expect(sql).toContain('ON CONFLICT ON CONSTRAINT unique_hotel_conversation')
    expect(sql).toContain('DO UPDATE')
    expect(sql).toContain('RETURNING')

    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      'SET LOCAL statement_timeout = 1500'
    )
    expect(mockClient.query).toHaveBeenNthCalledWith(3, expect.any(String), [
      conversation.reservation_id,
      conversation.host_id,
      conversation.guest_id,
      conversation.escrow_transaction_id,
    ])
    expect(mockClient.query).toHaveBeenLastCalledWith('COMMIT')
    expect(mockClient.release).toHaveBeenCalledTimes(1)
  })

  it('records the conversation and message in one budgeted transaction', async () => {
    mockClient.query
      .mockResolvedValueOnce({})                    // BEGIN
      .mockResolvedValueOnce({})                    // SET LOCAL statement_timeout
      .mockResolvedValueOnce({ rows: [conversation] }) // conversation upsert
      .mockResolvedValueOnce({ rows: [message] })   // message insert
      .mockResolvedValueOnce({})                    // COMMIT

    const result = await recordHotelConversationMessage(
      {
        ...upsertParams,
        senderId:     conversation.guest_id,
        body:         message.body,
        isAutomated:  true,
        eventType:    message.event_type,
      },
      900
    )

    expect(result).toEqual({ conversation, message })
    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      'SET LOCAL statement_timeout = 900'
    )

    const insertCall = mockClient.query.mock.calls[3]
    expect(insertCall[0]).toContain('INSERT INTO hotel_industry.messages')
    expect(insertCall[1]).toEqual([
      conversation.id,
      conversation.guest_id,
      message.body,
      true,
      message.event_type,
    ])
    expect(mockClient.query).toHaveBeenLastCalledWith('COMMIT')
    expect(mockClient.release).toHaveBeenCalledTimes(1)
  })

  it('rolls back and releases the client when a write fails', async () => {
    mockClient.query
      .mockResolvedValueOnce({})                    // BEGIN
      .mockResolvedValueOnce({})                    // SET LOCAL statement_timeout
      .mockResolvedValueOnce({ rows: [conversation] }) // conversation upsert
      .mockRejectedValueOnce(new Error('statement timeout'))
      .mockResolvedValueOnce({})                    // ROLLBACK

    await expect(
      recordHotelConversationMessage(
        {
          ...upsertParams,
          senderId: conversation.guest_id,
          body:     message.body,
        },
        100
      )
    ).rejects.toThrow('statement timeout')

    expect(mockClient.query).toHaveBeenLastCalledWith('ROLLBACK')
    expect(mockClient.release).toHaveBeenCalledTimes(1)
  })
})
