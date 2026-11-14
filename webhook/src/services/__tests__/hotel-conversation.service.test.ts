import { sendHotelConversationMessage } from '../hotel-conversation.service'
import {
  insertHotelMessage,
  upsertHotelConversation,
} from '../../repositories/hotel-conversation.repository'
import { withTransaction } from '../db'

const mockClient = { query: jest.fn() }

jest.mock('../db', () => ({
  withTransaction: jest.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(mockClient)),
}))

jest.mock('../../repositories/hotel-conversation.repository', () => ({
  upsertHotelConversation: jest.fn(),
  insertHotelMessage: jest.fn(),
}))

jest.mock('../hasura', () => ({
  hasuraRequest: jest.fn(() => {
    throw new Error('the conversation service must not use the admin Hasura client')
  }),
}))

const mockedUpsert = upsertHotelConversation as jest.MockedFunction<typeof upsertHotelConversation>
const mockedInsert = insertHotelMessage as jest.MockedFunction<typeof insertHotelMessage>
const mockedWithTransaction = withTransaction as jest.MockedFunction<typeof withTransaction>

const input = {
  reservationId: 'res-1',
  hostId: 'host-1',
  guestId: 'guest-1',
  escrowTransactionId: 'et-1',
  senderId: 'guest-1',
  body: 'Deposit confirmed',
  isAutomated: true,
  eventType: 'escrow_funded',
}

describe('sendHotelConversationMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedUpsert.mockResolvedValue('conv-1')
    mockedInsert.mockResolvedValue({
      id: 'msg-1',
      conversation_id: 'conv-1',
      body: input.body,
      is_automated: true,
      event_type: 'escrow_funded',
      created_at: '2026-11-14T00:00:00Z',
    })
  })

  it('upserts the conversation and appends the message in one transaction', async () => {
    const result = await sendHotelConversationMessage(input)

    expect(mockedWithTransaction).toHaveBeenCalledTimes(1)
    expect(mockedUpsert).toHaveBeenCalledWith(mockClient, {
      reservationId: 'res-1',
      hostId: 'host-1',
      guestId: 'guest-1',
      escrowTransactionId: 'et-1',
    })
    expect(mockedInsert).toHaveBeenCalledWith(mockClient, {
      conversationId: 'conv-1',
      senderId: 'guest-1',
      body: 'Deposit confirmed',
      isAutomated: true,
      eventType: 'escrow_funded',
    })
    expect(result.conversationId).toBe('conv-1')
    expect(result.message.id).toBe('msg-1')
  })

  it('defaults to a non-automated message without an event type', async () => {
    await sendHotelConversationMessage({
      reservationId: 'res-1',
      hostId: 'host-1',
      guestId: 'guest-1',
      senderId: 'host-1',
      body: 'hi',
    })

    expect(mockedInsert).toHaveBeenCalledWith(mockClient, expect.objectContaining({
      isAutomated: false,
      eventType: null,
    }))
  })

  it('propagates a failed message insert so the transaction rolls back', async () => {
    mockedInsert.mockRejectedValueOnce(new Error('check constraint violated'))

    await expect(sendHotelConversationMessage(input)).rejects.toThrow('check constraint violated')
  })
})
