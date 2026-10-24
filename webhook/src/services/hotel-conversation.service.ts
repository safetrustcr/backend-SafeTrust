'use strict'

import { hasuraRequest } from './hasura'

// Internal hotel_industry writes for the service-to-service conversations
// route (authenticated by x-internal-secret). Handlers call this service
// instead of the admin Hasura client.

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SendHotelMessageInput {
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

export interface HotelMessage {
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

export class HotelConversationUnavailableError extends Error {
  constructor() {
    super('Failed to find or create conversation')
    this.name = 'HotelConversationUnavailableError'
  }
}

// ── Service ────────────────────────────────────────────────────────────────────

/**
 * Find or create the conversation for a reservation and append a message.
 */
export async function sendHotelConversationMessage(
  input: SendHotelMessageInput
): Promise<{ conversationId: string; message: HotelMessage }> {
  const {
    reservation_id,
    escrow_transaction_id,
    sender_id,
    body,
    is_automated,
    event_type,
  } = input

  // Find or create the conversation in the hotel_industry schema
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
    throw new HotelConversationUnavailableError()
  }

  // Insert the message into the hotel_industry schema
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

  return { conversationId, message: msgData.insert_hotel_industry_messages_one }
}
