'use strict';

jest.mock('../../../../services/db', () => ({
  query: jest.fn(),
}));

const db = require('../../../../services/db');
const { sendHotelConversationHandler } = require('../send.handler');

function makeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

const ids = {
  reservationId: '11111111-1111-4111-8111-111111111111',
  hostId: '22222222-2222-4222-8222-222222222222',
  guestId: '33333333-3333-4333-8333-333333333333',
  senderId: '33333333-3333-4333-8333-333333333333',
  conversationId: '44444444-4444-4444-8444-444444444444',
  messageId: '55555555-5555-4555-8555-555555555555',
};

describe('sendHotelConversationHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when required fields are missing', async () => {
    const req = { body: { reservationId: ids.reservationId } };
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
    const createdAt = new Date('2026-07-27T00:00:00.000Z');
    db.query
      .mockResolvedValueOnce({ rows: [{ id: ids.conversationId }] })
      .mockResolvedValueOnce({
        rows: [{ id: ids.messageId, created_at: createdAt }],
      });

    const req = {
      body: {
        ...ids,
        body: 'Hello from guest',
      },
    };
    const res = makeResponse();

    await sendHotelConversationHandler(req, res);

    expect(db.query).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      conversationId: ids.conversationId,
      messageId: ids.messageId,
      lastMessageAt: createdAt,
    });
  });

  it('creates a conversation when none exists', async () => {
    const createdAt = new Date('2026-07-27T00:00:00.000Z');
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: ids.conversationId }] })
      .mockResolvedValueOnce({
        rows: [{ id: ids.messageId, created_at: createdAt }],
      });

    const req = {
      body: {
        ...ids,
        body: 'First message',
        escrowTransactionId: '66666666-6666-4666-8666-666666666666',
      },
    };
    const res = makeResponse();

    await sendHotelConversationHandler(req, res);

    expect(db.query).toHaveBeenCalledTimes(3);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      conversationId: ids.conversationId,
      messageId: ids.messageId,
      lastMessageAt: createdAt,
    });
  });
});
