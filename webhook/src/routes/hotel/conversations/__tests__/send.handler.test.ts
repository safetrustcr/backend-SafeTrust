'use strict'

import { Request, Response } from 'express'
import { sendHotelConversationHandler } from '../send.handler'
import { hasuraRequest } from '../../../../services/hasura'

jest.mock('../../../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
}))

const mockedHasuraRequest = hasuraRequest as jest.MockedFunction<typeof hasuraRequest>

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

const ids: Record<string, string> = {
  reservationId: '11111111-1111-4111-8111-111111111111',
  senderId: '33333333-3333-4333-8333-333333333333',
  conversationId: '44444444-4444-4444-8444-444444444444',
  messageId: '55555555-5555-4555-8555-555555555555',
}

describe('sendHotelConversationHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 400 when required fields are missing', async () => {
    const req = { body: { reservation_id: ids.reservationId } } as Request
    const res = makeResponse()

    await sendHotelConversationHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Missing required fields'),
      })
    )
  })

  it('finds existing conversation and appends a message', async () => {
    const createdAt = '2026-07-27T00:00:00.000Z'
    const message = {
      id: ids.messageId,
      conversation_id: ids.conversationId,
      body: 'Hello from guest',
      is_automated: false,
      event_type: null,
      created_at: createdAt,
    }

    mockedHasuraRequest
      .mockResolvedValueOnce({
        hotel_industry_conversations: [{ id: ids.conversationId }],
      })
      .mockResolvedValueOnce({
        insert_hotel_industry_messages_one: message,
      })

    const req = {
      body: {
        reservation_id: ids.reservationId,
        sender_id: ids.senderId,
        body: 'Hello from guest',
      },
    } as Request
    const res = makeResponse()

    await sendHotelConversationHandler(req, res)

    expect(mockedHasuraRequest).toHaveBeenCalledTimes(2)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ message })
  })

  it('creates a conversation when none exists', async () => {
    const createdAt = '2026-07-27T00:00:00.000Z'
    const escrowTransactionId = '66666666-6666-4666-8666-666666666666'
    const message = {
      id: ids.messageId,
      conversation_id: ids.conversationId,
      body: 'First message',
      is_automated: false,
      event_type: null,
      created_at: createdAt,
    }

    mockedHasuraRequest
      .mockResolvedValueOnce({ hotel_industry_conversations: [] })
      .mockResolvedValueOnce({
        insert_hotel_industry_conversations_one: { id: ids.conversationId },
      })
      .mockResolvedValueOnce({
        insert_hotel_industry_messages_one: message,
      })

    const req = {
      body: {
        reservation_id: ids.reservationId,
        sender_id: ids.senderId,
        body: 'First message',
        escrow_transaction_id: escrowTransactionId,
      },
    } as Request
    const res = makeResponse()

    await sendHotelConversationHandler(req, res)

    expect(mockedHasuraRequest).toHaveBeenCalledTimes(3)
    expect(mockedHasuraRequest).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('insert_hotel_industry_conversations_one'),
      {
        reservationId: ids.reservationId,
        escrowTransactionId,
      }
    )
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ message })
  })
})
