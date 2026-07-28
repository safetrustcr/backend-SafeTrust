'use strict';

const db = require('./db');

/**
 * Resolve hotel reservation + host/guest UUIDs for a TrustlessWork contract id.
 * Returns null when the contract is not a hotel_industry escrow (or tables missing).
 */
async function resolveHotelEscrowParties(contractId) {
  const result = await db.query(
    `SELECT
       et.id AS escrow_transaction_id,
       et.reservation_id,
       host_u.id AS host_id,
       guest_u.id AS guest_id
     FROM public.escrow_transactions et
     LEFT JOIN public.escrow_transaction_users host_etu
       ON host_etu.escrow_transaction_id = et.id
      AND UPPER(host_etu.role) IN ('OWNER', 'HOST')
     LEFT JOIN public.users host_u
       ON host_u.email = host_etu.user_email
     LEFT JOIN public.escrow_transaction_users guest_etu
       ON guest_etu.escrow_transaction_id = et.id
      AND UPPER(guest_etu.role) IN ('RENTER', 'GUEST')
     LEFT JOIN public.users guest_u
       ON guest_u.email = guest_etu.user_email
     WHERE et.contract_id = $1
     LIMIT 1`,
    [contractId],
  );

  const row = result.rows[0];
  if (!row?.reservation_id || !row?.host_id || !row?.guest_id) {
    return null;
  }

  return {
    reservationId: row.reservation_id,
    hostId: row.host_id,
    guestId: row.guest_id,
    escrowTransactionId: row.escrow_transaction_id,
  };
}

function webhookBaseUrl() {
  if (process.env.WEBHOOK_BASE_URL) {
    return process.env.WEBHOOK_BASE_URL.replace(/\/$/, '');
  }
  const port = process.env.WEBHOOK_PORT || process.env.PORT || 3001;
  return `http://127.0.0.1:${port}`;
}

/**
 * Best-effort automated lifecycle message into the hotel conversation.
 * Never throws — escrow status updates must not fail because of messaging.
 */
async function notifyHotelEscrowConversation({
  contractId,
  eventType,
  body,
}) {
  try {
    const parties = await resolveHotelEscrowParties(contractId);
    if (!parties) {
      console.log(
        `[conversations/send] ⏭ skip automated message — no hotel escrow parties for contractId: ${contractId}`,
      );
      return;
    }

    const payload = {
      reservationId: parties.reservationId,
      hostId: parties.hostId,
      guestId: parties.guestId,
      senderId: parties.guestId,
      body,
      isAutomated: true,
      eventType,
      escrowTransactionId: parties.escrowTransactionId,
    };

    const res = await fetch(
      `${webhookBaseUrl()}/api/hotel/conversations/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(
        `[conversations/send] ❌ automated message failed — status: ${res.status} ${text}`,
      );
      return;
    }

    console.log(
      `[conversations/send] ✅ automated message sent — event_type: ${eventType}`,
    );
  } catch (error) {
    console.error(
      `[conversations/send] ❌ automated message error — ${error.message}`,
    );
  }
}

module.exports = {
  resolveHotelEscrowParties,
  notifyHotelEscrowConversation,
  webhookBaseUrl,
};
