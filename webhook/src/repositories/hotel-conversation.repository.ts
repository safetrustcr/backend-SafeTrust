'use strict'

import { PoolClient } from 'pg'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface UpsertHotelConversationInput {
  reservationId:        string
  hostId:               string
  guestId:              string
  escrowTransactionId?: string | null
}

export interface InsertHotelMessageInput {
  conversationId: string
  senderId:       string
  body:           string
  isAutomated:    boolean
  eventType:      string | null
}

export interface HotelMessage {
  id:              string
  conversation_id: string
  body:            string
  is_automated:    boolean
  event_type:      string | null
  created_at:      string
}

// ── Queries ────────────────────────────────────────────────────────────────────

/**
 * Return the conversation id for (reservation, host, guest), creating the row
 * when it does not exist.
 *
 * Idempotency is enforced by the `unique_hotel_conversation` constraint, not by
 * a find-then-create in application code, so parallel deliveries for the same
 * reservation converge on one row. `DO UPDATE` (rather than `DO NOTHING`) is
 * deliberate: `RETURNING` yields the id on both the insert and the conflict
 * path, including when a concurrent transaction created the row first. The
 * update only fills a missing escrow link and never changes existing values.
 */
export async function upsertHotelConversation(
  client: PoolClient,
  input: UpsertHotelConversationInput
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO hotel_industry.conversations
       (reservation_id, host_id, guest_id, escrow_transaction_id, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT ON CONSTRAINT unique_hotel_conversation
     DO UPDATE SET escrow_transaction_id = COALESCE(
       hotel_industry.conversations.escrow_transaction_id,
       EXCLUDED.escrow_transaction_id
     )
     RETURNING id`,
    [input.reservationId, input.hostId, input.guestId, input.escrowTransactionId ?? null]
  )

  return result.rows[0].id
}

/** Append a message to a hotel conversation. */
export async function insertHotelMessage(
  client: PoolClient,
  input: InsertHotelMessageInput
): Promise<HotelMessage> {
  const result = await client.query<HotelMessage>(
    `INSERT INTO hotel_industry.messages
       (conversation_id, sender_id, body, is_automated, event_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, conversation_id, body, is_automated, event_type, created_at`,
    [input.conversationId, input.senderId, input.body, input.isAutomated, input.eventType]
  )

  return result.rows[0]
}
