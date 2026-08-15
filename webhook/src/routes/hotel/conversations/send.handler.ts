'use strict'

import { Request, Response } from 'express'
import { hasuraRequest } from '../../../services/hasura'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SendHotelMessagePayload {
  reservation_id:        string
  escrow_transaction_id?: string | null
  sender_id:             string
  body:                  string
  is_automated?:         boolean
  event_type?:           string | null
}

interface HotelConversation {
  id: string
}

interface HotelMessage {
  id:              string
  conversation_id: string
  body:            string
  is_automated:    boolean
  event_type:      string | null
  created_at:      string
}

interface FindConversationData {
  hotel_industry_conversations: HotelConversation[]
}

interface CreateConversationData {
  insert_hotel_industry_conversations_one: HotelConversation
}

interface InsertMessageData {
  insert_hotel_industry_messages_one: HotelMessage
}

// ── Handler ────────────────────────────────────────────────────────────────────

export const sendHotelConversationHandler = async (
  req: Request<{}, {}, SendHotelMessagePayload>,
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
    // 2 — Find or create conversation in hotel_industry schema
    const findConversationQuery = `
      query FindHotelConversation($reservationId: uuid!) {
        hotel_industry_conversations(
          where: { reservation_id: { _eq: $reservationId } }
          limit: 1
        ) {
          id
        }
      }
    `

    const convData = await hasuraRequest<FindConversationData>(
      findConversationQuery,
      { reservationId: reservation_id }
    )

    let conversationId = convData.hotel_industry_conversations?.[0]?.id

    if (!conversationId) {
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
      `

      const newConv = await hasuraRequest<CreateConversationData>(
        createConversationMutation,
        {
          reservationId:        reservation_id,
          escrowTransactionId:  escrow_transaction_id ?? null,
        }
      )

      conversationId = newConv.insert_hotel_industry_conversations_one?.id
    }

    if (!conversationId) {
      return res.status(500).json({
        error: 'Failed to find or create conversation',
      })
    }

    // 3 — Insert message into hotel_industry schema
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
          sender_id:       $senderId
          body:            $body
          is_automated:    $isAutomated
          event_type:      $eventType
        }) {
          id
          conversation_id
          body
          is_automated
          event_type
          created_at
        }
      }
    `

    const msgData = await hasuraRequest<InsertMessageData>(
      insertMessageMutation,
      {
        conversationId,
        senderId:    sender_id,
        body,
        isAutomated: is_automated ?? false,
        eventType:   event_type   ?? null,
      }
    )

    const message = msgData.insert_hotel_industry_messages_one

    console.log(
      `[hotel/conversations/send] ✅ Message sent — conversationId: ${conversationId}`
    )
    return res.status(201).json({ message })

  } catch (error) {
    const err = error as Error & { details?: unknown }
    console.error('[hotel/conversations/send] ❌ error:', err.details ?? err.message)
    return res.status(500).json({
      error:   'Failed to send message',
      details: err.message,
    })
  }
}