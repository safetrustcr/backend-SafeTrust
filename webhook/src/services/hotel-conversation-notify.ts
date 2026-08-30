'use strict'

import { query } from './db'

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

interface ConversationPayload {
  reservation_id:         string
  escrow_transaction_id?: string
  sender_id:              string
  body:                   string
  is_automated?:          boolean
  event_type?:            string
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

export function webhookBaseUrl(): string {
  if (process.env.WEBHOOK_BASE_URL) {
    return process.env.WEBHOOK_BASE_URL.replace(/\/$/, '')
  }
  const port = process.env.WEBHOOK_PORT ?? process.env.PORT ?? '3001'
  return `http://127.0.0.1:${port}`
}

/**
 * Best-effort automated lifecycle message into the hotel conversation.
 * Never throws — escrow status updates must not fail because of messaging.
 */
export async function notifyHotelEscrowConversation({
  contractId,
  eventType,
  body,
}: NotifyHotelEscrowConversationParams): Promise<void> {
  try {
    const parties = await resolveHotelEscrowParties(contractId)

    if (!parties) {
      console.log(
        `[conversations/send] ⏭ skip — no hotel escrow parties for contractId: ${contractId}`
      )
      return
    }

    const payload: ConversationPayload = {
      reservation_id:        parties.reservationId,
      escrow_transaction_id: parties.escrowId,
      sender_id:             parties.guestId,
      body,
      is_automated:          true,
      event_type:            eventType,
    }

    const internalSecret = process.env.INTERNAL_SERVICE_SECRET
    if (!internalSecret) {
      console.error('[conversations/send] ❌ INTERNAL_SERVICE_SECRET not set')
      return
    }

    const res = await fetch(
      `${webhookBaseUrl()}/api/hotel/conversations/send`,
      {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-internal-secret': internalSecret,
        },
        body: JSON.stringify(payload),
      }
    )

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(
        `[conversations/send] ❌ automated message failed — status: ${res.status} ${text}`
      )
      return
    }

    console.log(
      `[conversations/send] ✅ automated message sent — event_type: ${eventType}`
    )
  } catch (error) {
    const err = error as Error
    console.error(`[conversations/send] ❌ error — ${err.message}`)
  }
}

export default {
  resolveHotelEscrowParties,
  notifyHotelEscrowConversation,
  webhookBaseUrl,
}