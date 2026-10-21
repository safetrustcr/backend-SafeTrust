'use strict'

import { PoolClient } from 'pg'
import { pool } from '../services/db'

// ── Constants ──────────────────────────────────────────────────────────────────

/** Default server-side deadline for a notification write, in milliseconds. */
export const DEFAULT_CONVERSATION_DB_TIMEOUT_MS = 2_000

// ── Types ──────────────────────────────────────────────────────────────────────

export interface HotelConversationRecord {
  id:                    string
  reservation_id:        string
  host_id:               string
  guest_id:              string
  escrow_transaction_id: string | null
  status:                string
}

export interface HotelMessageRecord {
  id:              string
  conversation_id: string
  sender_id:       string
  body:            string
  is_automated:    boolean
  event_type:      string | null
  created_at:      string
}

export interface UpsertHotelConversationParams {
  reservationId:        string
  hostId:               string
  guestId:              string
  escrowTransactionId?: string | null
}

export interface AppendHotelMessageParams {
  conversationId: string
  senderId:       string
  body:           string
  isAutomated?:   boolean
  eventType?:     string | null
}

export interface RecordHotelConversationMessageParams
  extends UpsertHotelConversationParams {
  senderId:     string
  body:         string
  isAutomated?: boolean
  eventType?:   string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

type Queryable = Pick<PoolClient, 'query'>

/**
 * Run `operation` inside a transaction with a PostgreSQL `statement_timeout`.
 * The server aborts the statement when the budget is exceeded, so a slow or
 * lock-blocked write can never hold the caller past its deadline.
 */
async function runWithDbBudget<T>(
  timeoutMs: number,
  operation: (client: Queryable) => Promise<T>
): Promise<T> {
  const budgetMs = Math.max(1, Math.floor(timeoutMs))
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL statement_timeout = ${budgetMs}`)
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      console.error(
        '[hotel-conversation.repository] rollback failed:',
        rollbackError
      )
    }
    throw error
  } finally {
    client.release()
  }
}

/**
 * Idempotent conversation create.
 *
 * `unique_hotel_conversation (reservation_id, host_id, guest_id)` is the
 * conflict target, so parallel notifications for the same booking converge on
 * a single conversation row instead of racing a find-then-create lookup.
 */
async function upsertConversation(
  client: Queryable,
  params: UpsertHotelConversationParams
): Promise<HotelConversationRecord> {
  const result = await client.query<HotelConversationRecord>(
    `INSERT INTO hotel_industry.conversations AS conversation (
       reservation_id,
       host_id,
       guest_id,
       escrow_transaction_id,
       status
     ) VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT ON CONSTRAINT unique_hotel_conversation
     DO UPDATE SET
       escrow_transaction_id = COALESCE(
         EXCLUDED.escrow_transaction_id,
         conversation.escrow_transaction_id
       )
     RETURNING
       id,
       reservation_id,
       host_id,
       guest_id,
       escrow_transaction_id,
       status`,
    [
      params.reservationId,
      params.hostId,
      params.guestId,
      params.escrowTransactionId ?? null,
    ]
  )

  return result.rows[0]
}

async function insertMessage(
  client: Queryable,
  params: AppendHotelMessageParams
): Promise<HotelMessageRecord> {
  const result = await client.query<HotelMessageRecord>(
    `INSERT INTO hotel_industry.messages (
       conversation_id,
       sender_id,
       body,
       is_automated,
       event_type
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING
       id,
       conversation_id,
       sender_id,
       body,
       is_automated,
       event_type,
       created_at`,
    [
      params.conversationId,
      params.senderId,
      params.body,
      params.isAutomated ?? false,
      params.eventType ?? null,
    ]
  )

  return result.rows[0]
}

// ── Repository functions ───────────────────────────────────────────────────────

/**
 * Create the conversation for a reservation or return the existing one.
 * Safe to call concurrently — the database enforces the uniqueness rule.
 */
export async function upsertHotelConversation(
  params: UpsertHotelConversationParams,
  timeoutMs: number = DEFAULT_CONVERSATION_DB_TIMEOUT_MS
): Promise<HotelConversationRecord> {
  return runWithDbBudget(timeoutMs, (client) => upsertConversation(client, params))
}

/**
 * Append a message to an existing conversation.
 */
export async function appendHotelMessage(
  params: AppendHotelMessageParams,
  timeoutMs: number = DEFAULT_CONVERSATION_DB_TIMEOUT_MS
): Promise<HotelMessageRecord> {
  return runWithDbBudget(timeoutMs, (client) => insertMessage(client, params))
}

/**
 * Idempotently upsert the conversation and append the message in one
 * transaction. Used by the notification service so a failed message insert
 * does not leave a partially-written notification.
 */
export async function recordHotelConversationMessage(
  params: RecordHotelConversationMessageParams,
  timeoutMs: number = DEFAULT_CONVERSATION_DB_TIMEOUT_MS
): Promise<{ conversation: HotelConversationRecord; message: HotelMessageRecord }> {
  return runWithDbBudget(timeoutMs, async (client) => {
    const conversation = await upsertConversation(client, params)
    const message = await insertMessage(client, {
      conversationId: conversation.id,
      senderId:       params.senderId,
      body:           params.body,
      isAutomated:    params.isAutomated,
      eventType:      params.eventType,
    })

    return { conversation, message }
  })
}

export default {
  upsertHotelConversation,
  appendHotelMessage,
  recordHotelConversationMessage,
}
