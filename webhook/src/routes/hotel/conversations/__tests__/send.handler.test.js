'use strict';

jest.mock('../../../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
}));

const { hasuraRequest } = require('../../../../services/hasura');
const { sendHotelConversationHandler } = require('../send.handler');

function makeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

const ids = {
  reservation_id: '11111111-1111-4111-8111-111111111111',
  sender_id: '33333333-3333-4333-8333-333333333333',
  conversationId: '44444444-4444-4444-8444-444444444444',
  messageId: '55555555-5555-4555-8555-555555555555',
};

describe('sendHotelConversationHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when required fields are missing', async () => {
    const req = { body: { reservation_id: ids.reservation_id } };
    const res = makeResponse();

    await sendHotelConversationHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Missing required fields'),
      }),
    );
  });

  it('finds existing conversation and appends a message', async () => {
    const createdAt = new Date('2026-07-27T00:00:00.000Z').toISOString();
    hasuraRequest
      .mockResolvedValueOnce({
        hotel_industry_conversations: [{ id: ids.conversationId }],
      })
      .mockResolvedValueOnce({
        insert_hotel_industry_messages_one: {
          id: ids.messageId,
          conversation_id: ids.conversationId,
          body: 'Hello from guest',
          is_automated: false,
          event_type: null,
          created_at: createdAt,
        },
      });

    const req = {
      body: {
        reservation_id: ids.reservation_id,
        sender_id: ids.sender_id,
        body: 'Hello from guest',
      },
    };
    const res = makeResponse();

    await sendHotelConversationHandler(req, res);

    expect(hasuraRequest).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: {
        id: ids.messageId,
        conversation_id: ids.conversationId,
        body: 'Hello from guest',
        is_automated: false,
        event_type: null,
        created_at: createdAt,
      },
    });
  });

  it('creates a conversation when none exists', async () => {
    const createdAt = new Date('2026-07-27T00:00:00.000Z').toISOString();
    const escrowTransactionId = '66666666-6666-4666-8666-666666666666';

    hasuraRequest
      .mockResolvedValueOnce({
        hotel_industry_conversations: [],
      })
      .mockResolvedValueOnce({
        insert_hotel_industry_conversations_one: { id: ids.conversationId },
      })
      .mockResolvedValueOnce({
        insert_hotel_industry_messages_one: {
          id: ids.messageId,
          conversation_id: ids.conversationId,
          body: 'First message',
          is_automated: false,
          event_type: null,
          created_at: createdAt,
        },
      });

    const req = {
      body: {
        reservation_id: ids.reservation_id,
        sender_id: ids.sender_id,
        body: 'First message',
        escrow_transaction_id: escrowTransactionId,
      },
    };
    const res = makeResponse();

    await sendHotelConversationHandler(req, res);

    expect(hasuraRequest).toHaveBeenCalledTimes(3);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: {
        id: ids.messageId,
        conversation_id: ids.conversationId,
        body: 'First message',
        is_automated: false,
        event_type: null,
        created_at: createdAt,
      },
    });
  });
});
