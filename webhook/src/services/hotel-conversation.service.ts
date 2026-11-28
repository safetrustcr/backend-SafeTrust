'use strict'

import { withTransaction } from '../db/pool'
import {
  HotelMessage,
  insertHotelMessage,
  upsertHotelConversation,
} from '../repositories/hotel-conversation.repository'

export type { HotelMessage } from '../repositories/hotel-conversation.repository'

// Shared hotel_industry conversation writes. Lifecycle notifications and any
// future internal caller use this service directly; there is no HTTP hop.

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SendHotelMessageInput {
  reservationId:        string
  hostId:               string
  guestId:              string
  escrowTransactionId?: string | null
  senderId:             string
  body:                 string
  isAutomated?:         boolean
  eventType?:           string | null
}

// ── Service ────────────────────────────────────────────────────────────────────

/**
 * Ensure the reservation's conversation exists and append a message, in one
 * transaction so a message is never written without its conversation.
 */
export async function sendHotelConversationMessage(
  input: SendHotelMessageInput
): Promise<{ conversationId: string; message: HotelMessage }> {
  return withTransaction(async (client) => {
    const conversationId = await upsertHotelConversation(client, {
      reservationId:       input.reservationId,
      hostId:              input.hostId,
      guestId:             input.guestId,
      escrowTransactionId: input.escrowTransactionId,
    })

    const message = await insertHotelMessage(client, {
      conversationId,
      senderId:    input.senderId,
      body:        input.body,
      isAutomated: input.isAutomated ?? false,
      eventType:   input.eventType ?? null,
    })

    return { conversationId, message }
  })
}
