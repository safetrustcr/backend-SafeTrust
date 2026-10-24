'use strict'

import { Request, Response } from 'express'
import {
  HotelConversationUnavailableError,
  sendHotelConversationMessage,
  SendHotelMessageInput,
} from '../../../services/hotel-conversation.service'

// ── Handler ────────────────────────────────────────────────────────────────────

export const sendHotelConversationHandler = async (
  req: Request<{}, {}, SendHotelMessageInput>,
  res: Response
): Promise<Response> => {
  const {
    reservation_id,
    escrow_transaction_id,
    sender_id,
    body,
    is_automated,
    event_type,
  } = req.body

  // 1 — Validate required fields
  if (!reservation_id || !sender_id || !body) {
    return res.status(400).json({
      error: 'Missing required fields: reservation_id, sender_id, body',
    })
  }

  try {
    // 2 — Find or create the conversation and insert the message
    const { conversationId, message } = await sendHotelConversationMessage({
      reservation_id,
      escrow_transaction_id,
      sender_id,
      body,
      is_automated,
      event_type,
    })

    console.log(
      `[hotel/conversations/send] ✅ Message sent — conversationId: ${conversationId}`
    )
    return res.status(201).json({ message })

  } catch (error) {
    if (error instanceof HotelConversationUnavailableError) {
      return res.status(500).json({ error: error.message })
    }

    const err = error as Error & { details?: unknown }
    console.error('[hotel/conversations/send] ❌ error:', err.details ?? err.message)
    return res.status(500).json({
      error:   'Failed to send message',
      details: err.message,
    })
  }
}