'use strict'

import { query } from './db'
import {
  DEFAULT_CONVERSATION_DB_TIMEOUT_MS,
  HotelMessageRecord,
  recordHotelConversationMessage,
} from '../repositories/hotel-conversation.repository'

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Hard budget for a lifecycle notification. The lifecycle response never waits
 * longer than this, even if the database is slow or lock-blocked.
 */
export const DEFAULT_NOTIFICATION_TIMEOUT_MS = DEFAULT_CONVERSATION_DB_TIMEOUT_MS

// ── Types ──────────────────────────────────────────────────────────────────────

export interface HotelEscrowParties {
  reservationId: string
  apartmentId:   string
  hostId:        string
  guestId:       string
  escrowId:      string
}

export interface NotifyHotelEscrowConversationParams {
  contractId: string
  eventType:  string
  body:       string
  timeoutMs?: number
}

export interface SendHotelConversationMessageParams {
  reservationId:        string
  hostId:               string
  guestId:              string
  escrowTransactionId?: string | null
  senderId:             string
  body:                 string
  isAutomated?:         boolean
  eventType?:           string | null
  timeoutMs?:           number
}

// ── Errors ─────────────────────────────────────────────────────────────────────

export class NotificationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`hotel conversation notification exceeded its ${timeoutMs}ms budget`)
    this.name = 'NotificationTimeoutError'
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new NotificationTimeoutError(timeoutMs)), timeoutMs)
    // Never keep the process (or a Jest worker) alive for a best-effort timer.
    timer.unref?.()
  })

  return Promise.race([operation(), timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/**
 * Resolve hotel reservation + host/guest UUIDs for a TrustlessWork contract id.
 * Returns null when the contract is not a hotel_industry escrow.
 */
export async function resolveHotelEscrowParties(
  contractId: string
): Promise<HotelEscrowParties | null> {
  const result = await query<{
    reservation_id:        string
    escrow_transaction_id: string
    apartment_id:          string
    host_id:               string
    guest_id:              string
  }>(
    `SELECT
       res.id          AS reservation_id,
       et.id           AS escrow_transaction_id,
       r.apartment_id,
       host_u.id       AS host_id,
       guest_u.id      AS guest_id
     FROM safetrust.escrow_transactions et
     JOIN hotel_industry.reservations res
       ON et.reservation_id = res.id
     JOIN hotel_industry.rooms r
       ON res.room_id = r.room_id
     LEFT JOIN hotel_industry.escrow_transaction_users host_etu
       ON host_etu.escrow_transaction_id = et.id
      AND UPPER(host_etu.role) IN ('OWNER', 'HOST')
     LEFT JOIN hotel_industry.users host_u
       ON host_u.email = host_etu.user_email
     LEFT JOIN hotel_industry.escrow_transaction_users guest_etu
       ON guest_etu.escrow_transaction_id = et.id
      AND UPPER(guest_etu.role) IN ('RENTER', 'GUEST')
     LEFT JOIN hotel_industry.users guest_u
       ON guest_u.email = guest_etu.user_email
     WHERE et.contract_id = $1
     LIMIT 1`,
    [contractId]
  )

  const row = result.rows[0]
  if (!row?.reservation_id || !row?.apartment_id || !row?.host_id || !row?.guest_id) {
    return null
  }

  return {
    reservationId: row.reservation_id,
    apartmentId:   row.apartment_id,
    hostId:        row.host_id,
    guestId:       row.guest_id,
    escrowId:      row.escrow_transaction_id,
  }
}

// ── Shared conversation service ────────────────────────────────────────────────

/**
 * Direct, in-process conversation write.
 *
 * This is the shared service entrypoint for any internal caller (lifecycle
 * handlers today, future workers tomorrow). It never performs an HTTP request
 * back into this application; the conversation upsert is idempotent at the
 * database level.
 */
export async function sendHotelConversationMessage(
  params: SendHotelConversationMessageParams
): Promise<HotelMessageRecord> {
  const {
    timeoutMs = DEFAULT_NOTIFICATION_TIMEOUT_MS,
    ...conversationParams
  } = params

  const { message } = await recordHotelConversationMessage(
    conversationParams,
    timeoutMs
  )

  return message
}

/**
 * Best-effort automated lifecycle message into the hotel conversation.
 *
 * The whole operation (party lookup + conversation upsert + message insert) is
 * bounded by `timeoutMs`. Never throws — escrow status updates must not fail
 * because of messaging.
 *
 * Delivery is best-effort. If durable delivery ever becomes a requirement, the
 * minimal addition is a small notification/outbox row that a retry loop can
 * drain — not a message broker.
 *
 * @returns `true` when the message was persisted, `false` when it was skipped
 * or failed. Callers should treat `false` as non-fatal.
 */
export async function notifyHotelEscrowConversation({
  contractId,
  eventType,
  body,
  timeoutMs = DEFAULT_NOTIFICATION_TIMEOUT_MS,
}: NotifyHotelEscrowConversationParams): Promise<boolean> {
  const budgetMs = Math.max(1, timeoutMs)
  const deadline = Date.now() + budgetMs

  try {
    return await withTimeout(async () => {
      const parties = await resolveHotelEscrowParties(contractId)

      if (!parties) {
        console.log(
          `[conversations/send] ⏭ skip — no hotel escrow parties for contractId: ${contractId}`
        )
        return false
      }

      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) {
        throw new NotificationTimeoutError(budgetMs)
      }

      await sendHotelConversationMessage({
        reservationId:        parties.reservationId,
        hostId:               parties.hostId,
        guestId:              parties.guestId,
        escrowTransactionId:  parties.escrowId,
        senderId:             parties.guestId,
        body,
        isAutomated:          true,
        eventType,
        timeoutMs:            remainingMs,
      })

      console.log(
        `[conversations/send] ✅ automated message sent — event_type: ${eventType}`
      )
      return true
    }, budgetMs)
  } catch (error) {
    const err = error as Error
    console.error(`[conversations/send] ❌ error — ${err.message}`)
    return false
  }
}

export default {
  resolveHotelEscrowParties,
  sendHotelConversationMessage,
  notifyHotelEscrowConversation,
  NotificationTimeoutError,
  DEFAULT_NOTIFICATION_TIMEOUT_MS,
}
