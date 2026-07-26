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

  // 4 — Persist to public.trustless_work_escrows via Hasura GraphQL mutation
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

    console.log(`[escrow/initialize] Escrow persisted — contract_id: ${contract_id}, id: ${escrow.id}`);
    await markWebhookEventProcessed(eventId);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[escrow/initialize] Exception:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = { initializeEscrowHandler };
