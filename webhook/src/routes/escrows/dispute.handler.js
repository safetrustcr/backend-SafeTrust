'use strict';

const {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} = require('../../services/hasura');

const EVENT_TYPE = 'escrow.disputed';

const disputeEscrowHandler = async (req, res) => {
  const { contractId, disputeFlag, disputer } = req.body;

  if (!contractId || disputeFlag === undefined || !disputer) {
    return res.status(400).json({
      error: 'Missing required fields: contractId, disputeFlag, disputer'
    });
  }

  if (disputeFlag !== true) {
    return res.status(400).json({
      error: 'disputeFlag must be true to open a dispute'
    });
  }

  try {
    // 1 — Idempotency check
    const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
      contractId,
      EVENT_TYPE,
      req.body
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId);
      return res.status(200).json({ received: true });
    }

    // 2 — Update trustless_work_escrows
    const mutation = `
      mutation DisputeEscrow($contractId: String!) {
        update_trustless_work_escrows(
          where: { contractId: { _eq: $contractId } }
          _set: {
            status: "disputed"
          }
        ) {
          returning { id contractId status }
        }
      }
    `;

    const data = await hasuraRequest(mutation, { contractId });
    const updated = data.update_trustless_work_escrows?.returning;

    if (!updated || !updated.length) {
      return res.status(404).json({
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    // 3 — Mirror status to safetrust.reservations
    const mirrorMutation = `
      mutation MirrorDisputedToReservation($contractId: String!) {
        update_reservations(
          where: { escrow: { contractId: { _eq: $contractId } } }
          _set: {
            status: "disputed"
            updated_at: "now()"
          }
        ) {
          returning { id status }
        }
      }
    `;

    await hasuraRequest(mirrorMutation, { contractId });

    await markWebhookEventProcessed(eventId);

    console.log(`[escrow/dispute] ✅ Dispute opened — contractId: ${contractId}, disputer: ${disputer}`);
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[escrow/dispute] ❌ error:', error.details || error.message);
    if (error.details) {
      return res.status(500).json({ error: 'Failed to update escrow status', details: error.details });
    }
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = { disputeEscrowHandler };