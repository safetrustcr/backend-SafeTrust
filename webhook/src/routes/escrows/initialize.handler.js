'use strict';

const {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} = require('../../services/hasura');

const EVENT_TYPE = 'escrow.initialized';

const initializeEscrowHandler = async (req, res) => {
  const {
    contract_id,
    marker,
    approver,
    releaser,
    resolver,
    amount,
    escrow_type,
    asset_code,
    asset_issuer,
    booking_id,
    room_id,
    hotel_id,
    guest_id,
    booking_metadata,
  } = req.body;

  // 1 — Validate required fields
  if (!contract_id || !marker || !approver || !releaser || !amount || !escrow_type) {
    return res.status(400).json({
      error: 'Missing required fields: contract_id, marker, approver, releaser, amount, escrow_type'
    });
  }

  // 2 — Validate escrow_type matches migration CHECK constraint
  const validTypes = ['single_release', 'multi_release'];
  if (!validTypes.includes(escrow_type)) {
    return res.status(400).json({
      error: `escrow_type must be one of: ${validTypes.join(', ')}`
    });
  }

  const mutation = `
    mutation InitializeEscrow($object: trustless_work_escrows_insert_input!) {
      insert_trustless_work_escrows_one(object: $object) {
        id
        contractId
        status
        createdAt
      }
    }
  `;

  try {
    // 3 — Idempotency check
    const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
      contract_id,
      EVENT_TYPE,
      req.body
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId);
      return res.status(200).json({ received: true });
    }

    // 4 — Persist to safetrust.trustless_work_escrows via Hasura GraphQL mutation
    const data = await hasuraRequest(mutation, {
      object: {
        contractId: contract_id,
        marker,
        approver,
        releaser,
        resolver: resolver || null,
        escrowType: escrow_type,
        status: 'created',
        assetCode: asset_code || 'USDC',
        assetIssuer: asset_issuer || null,
        amount,
        balance: 0,
        bookingId: booking_id || null,
        roomId: room_id || null,
        hotelId: hotel_id || null,
        guestId: guest_id || null,
        tenantId: 'safetrust',
        escrowMetadata: req.body,
        bookingMetadata: booking_metadata || null,
      }
    });

    const escrow = data.insert_trustless_work_escrows_one;
    if (!escrow) {
      return res.status(500).json({ error: 'Failed to insert escrow record' });
    }

    // 5 — Link escrow to reservation AFTER escrow is confirmed to exist
    // booking_metadata.reservation_id is set by the frontend when BOOK was clicked
    const reservationId = booking_metadata?.reservation_id;
    if (reservationId) {
      const linkMutation = `
        mutation LinkEscrowToReservation($reservationId: uuid!, $escrowId: uuid!) {
          update_reservations_by_pk(
            pk_columns: { id: $reservationId }
            _set: {
              escrow_id: $escrowId,
              status: "escrow_created",
              updated_at: "now()"
            }
          ) {
            id status escrow_id
          }
        }
      `;

      await hasuraRequest(linkMutation, {
        reservationId,
        escrowId: escrow.id
      });

      console.log(`[escrow/initialize] Reservation linked — reservationId: ${reservationId}, escrowId: ${escrow.id}`);
    }

    console.log(`[escrow/initialize] ✅ Escrow persisted — contract_id: ${contract_id}, id: ${escrow.id}`);
    await markWebhookEventProcessed(eventId);
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[escrow/initialize] ❌ Error:', error.details || error.message);
    if (error.details) {
      return res.status(500).json({ error: 'Failed to persist escrow record', details: error.details });
    }
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = { initializeEscrowHandler };