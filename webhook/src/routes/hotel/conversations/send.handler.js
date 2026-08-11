'use strict';

const { hasuraRequest } = require('../../../services/hasura');

const sendHotelConversationHandler = async (req, res) => {
  const { reservation_id, escrow_transaction_id, sender_id, body, is_automated, event_type } = req.body;

  if (!reservation_id || !sender_id || !body) {
    return res.status(400).json({
      error: 'Missing required fields: reservation_id, sender_id, body'
    });
  }

  try {
    // 1 — Find or create conversation in hotel_industry schema
    const findConversationQuery = `
      query FindHotelConversation($reservationId: uuid!) {
        hotel_industry_conversations(
          where: { reservation_id: { _eq: $reservationId } }
          limit: 1
        ) {
          id
        }
      }
    `;

    const convData = await hasuraRequest(findConversationQuery, {
      reservationId: reservation_id
    });

    let conversationId = convData.hotel_industry_conversations?.[0]?.id;

    if (!conversationId) {
      // Create conversation if it doesn't exist
      const createConversationMutation = `
        mutation CreateHotelConversation(
          $reservationId: uuid!
          $escrowTransactionId: uuid
        ) {
          insert_hotel_industry_conversations_one(object: {
            reservation_id: $reservationId
            escrow_transaction_id: $escrowTransactionId
            status: "active"
          }) {
            id
          }
        }
      `;

      const newConv = await hasuraRequest(createConversationMutation, {
        reservationId: reservation_id,
        escrowTransactionId: escrow_transaction_id || null
      });

      conversationId = newConv.insert_hotel_industry_conversations_one?.id;
    }

    if (!conversationId) {
      return res.status(500).json({ error: 'Failed to find or create conversation' });
    }

    // 2 — Insert message into hotel_industry schema
    const insertMessageMutation = `
      mutation SendHotelMessage(
        $conversationId: uuid!
        $senderId: uuid!
        $body: String!
        $isAutomated: Boolean!
        $eventType: String
      ) {
        insert_hotel_industry_messages_one(object: {
          conversation_id: $conversationId
          sender_id: $senderId
          body: $body
          is_automated: $isAutomated
          event_type: $eventType
        }) {
          id
          conversation_id
          body
          is_automated
          event_type
          created_at
        }
      }
    `;

    const msgData = await hasuraRequest(insertMessageMutation, {
      conversationId,
      senderId: sender_id,
      body,
      isAutomated: is_automated || false,
      eventType: event_type || null
    });

    const message = msgData.insert_hotel_industry_messages_one;

    console.log(`[hotel/conversations/send] ✅ Message sent — conversationId: ${conversationId}`);
    return res.status(201).json({ message });

  } catch (error) {
    console.error('[hotel/conversations/send] ❌ error:', error.details || error.message);
    return res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
};

module.exports = { sendHotelConversationHandler };