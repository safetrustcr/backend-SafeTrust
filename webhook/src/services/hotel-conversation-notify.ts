'use strict'

import { query } from './db'
import { sendHotelConversationMessage } from './hotel-conversation.service'

// ── Types ──────────────────────────────────────────────────────────────────────

interface HotelEscrowParties {
  reservationId: string
  apartmentId:   string
  hostId:        string
  guestId:       string
  escrowId:      string
}

interface NotifyHotelEscrowConversationParams {
  contractId: string
  eventType:  string
  body:       string
}

interface NotifyOptions {
  /** Upper bound on how long a lifecycle response waits for the notification. */
  timeoutMs?: number
}

/**
 * Time budget for a lifecycle notification. Lifecycle handlers await the
 * notification after their transaction commits, so this caps how long a slow
 * database can hold the TrustlessWork callback response open.
 */
export const NOTIFICATION_TIMEOUT_MS = 3_000

class NotificationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`notification exceeded ${timeoutMs}ms time budget`)
    this.name = 'NotificationTimeoutError'
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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
     FROM hotel_industry.escrow_transactions et
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

/**
 * Settle with `work`, or reject once `timeoutMs` elapses. The budget bounds
 * how long the caller waits; it does not cancel `work`, whose transaction
 * either commits or rolls back on its own.
 */
async function withinTimeBudget<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new NotificationTimeoutError(timeoutMs)), timeoutMs)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function deliverHotelEscrowMessage({
  contractId,
  eventType,
  body,
}: NotifyHotelEscrowConversationParams): Promise<void> {
  const parties = await resolveHotelEscrowParties(contractId)

  if (!parties) {
    console.log(
      `[hotel-notify] ⏭ skip — no hotel escrow parties for contractId: ${contractId}`
    )
    return
  }

  await sendHotelConversationMessage({
    reservationId:       parties.reservationId,
    hostId:              parties.hostId,
    guestId:             parties.guestId,
    escrowTransactionId: parties.escrowId,
    senderId:            parties.guestId,
    body,
    isAutomated:         true,
    eventType,
  })

  console.log(`[hotel-notify] ✅ automated message sent — event_type: ${eventType}`)
}

// ── Service ────────────────────────────────────────────────────────────────────

/**
 * Best-effort automated lifecycle message into the hotel conversation.
 *
 * Calls the conversation service in-process and resolves within
 * `NOTIFICATION_TIMEOUT_MS`. Never throws — escrow status updates must not
 * fail or stall because of messaging.
 */
export async function notifyHotelEscrowConversation(
  params: NotifyHotelEscrowConversationParams,
  { timeoutMs = NOTIFICATION_TIMEOUT_MS }: NotifyOptions = {}
): Promise<void> {
  const work = deliverHotelEscrowMessage(params)
  // The timeout may win the race; keep a late rejection from going unhandled.
  work.catch(() => undefined)

  try {
    await withinTimeBudget(work, timeoutMs)
  } catch (error) {
    const err = error as Error
    console.error(
      `[hotel-notify] ❌ ${params.eventType} for contractId ${params.contractId} — ${err.message}`
    )
  }
}

export default {
  resolveHotelEscrowParties,
  notifyHotelEscrowConversation,
}
