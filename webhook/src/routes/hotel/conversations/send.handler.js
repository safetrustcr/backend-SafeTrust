'use strict';

const db = require('../../../services/db');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REQUIRED = ['reservationId', 'hostId', 'guestId', 'senderId', 'body'];

/**
 * Find-or-create a hotel conversation for a reservation/host/guest triple,
 * then append a message. DB trigger updates conversations.last_message_at.
 */
async function sendHotelConversationHandler(req, res) {
  const {
    reservationId,
    hostId,
    guestId,
    senderId,
    body,
    isAutomated = false,
    eventType = null,
    escrowTransactionId = null,
  } = req.body || {};

  const missing = REQUIRED.filter((key) => {
    const value = req.body?.[key];
    return value === undefined || value === null || String(value).trim() === '';
  });

  if (missing.length > 0) {
    console.error(
      `[conversations/send] ❌ missing required fields: ${missing.join(', ')}`,
    );
    return res.status(400).json({
      error: `Missing required fields: ${missing.join(', ')}`,
    });
  }

  for (const [label, value] of [
    ['reservationId', reservationId],
    ['hostId', hostId],
    ['guestId', guestId],
    ['senderId', senderId],
  ]) {
    if (!UUID_RE.test(String(value))) {
      return res.status(400).json({ error: `${label} must be a valid UUID` });
    }
  }

  if (
    escrowTransactionId != null &&
    escrowTransactionId !== '' &&
    !UUID_RE.test(String(escrowTransactionId))
  ) {
    return res
      .status(400)
      .json({ error: 'escrowTransactionId must be a valid UUID or null' });
  }

  const text = String(body).trim();
  if (!text || text.length > 4000) {
    return res.status(400).json({
      error: 'body must be between 1 and 4000 characters',
    });
  }

  if (eventType != null && !isAutomated) {
    return res.status(400).json({
      error: 'eventType is only allowed when isAutomated is true',
    });
  }

  if (String(hostId) === String(guestId)) {
    return res.status(400).json({
      error: 'hostId and guestId must be different',
    });
  }

  try {
    let conversationId;

    const existing = await db.query(
      `SELECT id FROM public.conversations
       WHERE reservation_id = $1 AND host_id = $2 AND guest_id = $3`,
      [reservationId, hostId, guestId],
    );

    conversationId = existing.rows[0]?.id;

    if (!conversationId) {
      try {
        const created = await db.query(
          `INSERT INTO public.conversations
             (reservation_id, host_id, guest_id, escrow_transaction_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [
            reservationId,
            hostId,
            guestId,
            escrowTransactionId || null,
          ],
        );
        conversationId = created.rows[0].id;
      } catch (err) {
        // Concurrent find-or-create race — unique_hotel_conversation
        if (err.code === '23505') {
          const again = await db.query(
            `SELECT id FROM public.conversations
             WHERE reservation_id = $1 AND host_id = $2 AND guest_id = $3`,
            [reservationId, hostId, guestId],
          );
          conversationId = again.rows[0]?.id;
        } else {
          throw err;
        }
      }
    }

    if (!conversationId) {
      return res.status(500).json({ error: 'Failed to resolve conversation' });
    }

    const msg = await db.query(
      `INSERT INTO public.messages
         (conversation_id, sender_id, body, is_automated, event_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [
        conversationId,
        senderId,
        text,
        Boolean(isAutomated),
        eventType ?? null,
      ],
    );

    const messageId = msg.rows[0].id;
    const lastMessageAt = msg.rows[0].created_at;

    if (isAutomated) {
      console.log(
        `[conversations/send] ✅ automated message sent — event_type: ${eventType} conversationId: ${conversationId}, messageId: ${messageId}`,
      );
    } else {
      console.log(
        `[conversations/send] ✅ message sent — conversationId: ${conversationId}, messageId: ${messageId}`,
      );
    }

    return res.status(200).json({
      conversationId,
      messageId,
      lastMessageAt,
    });
  } catch (error) {
    console.error('[conversations/send] ❌ error:', error.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
}

module.exports = { sendHotelConversationHandler };
