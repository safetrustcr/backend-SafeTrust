'use strict';

const {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} = require('../../services/hasura');
const {
  notifyHotelEscrowConversation,
} = require('../../services/hotel-conversation-notify');

const EVENT_TYPE = 'escrow.completed';

const releaseFundsHandler = async (req, res) => {
  const { contractId, releaseSigner } = req.body;

  if (!contractId || !releaseSigner) {
    return res.status(400).json({
      error: 'Missing required fields: contractId, releaseSigner'
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

    const { getValidPriorStates } = require('../../../../crates/escrow-state-machine');
    const validStatesJson = getValidPriorStates('completed', 'funds.released');
    const validStates = JSON.parse(validStatesJson);

    // 2 — Update trustless_work_escrows
    const mutation = `
      mutation ReleaseFunds($contractId: String!, $validStates: [String!]!) {
        update_trustless_work_escrows(
          where: { 
            contractId: { _eq: $contractId },
            status: { _in: $validStates }
          }
          _set: {
            status: "completed"
            balance: 0
          }
        ) {
          returning { id contractId status balance }
        }
      }
    `;

    const data = await hasuraRequest(mutation, { contractId, validStates });
    const updated = data.update_trustless_work_escrows?.returning;

    if (!updated || !updated.length) {
      return res.status(404).json({
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    const escrowId = updated[0].id;

    // 3 — Mirror status to public.reservations
    const mirrorMutation = `
      mutation MirrorCompletedToReservation($escrowId: uuid!) {
        update_safetrust_reservations(
          where: { escrowId: { _eq: $escrowId } }
          _set: {
            status: "completed"
            updatedAt: "now()"
          }
        ) {
          returning { id status }
        }
      }
    `;

    await hasuraRequest(mirrorMutation, { escrowId });

    // 4 — Notify hotel conversation (best-effort, never fail the response)
    await notifyHotelEscrowConversation({
      contractId,
      eventType: 'escrow_completed',
      body: 'SafeTrust: Funds have been released. Thank you for booking with us.',
    });

    await markWebhookEventProcessed(eventId);

    console.log(`[escrow/release-funds] ✅ Funds released — contractId: ${contractId}`);
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[escrow/release-funds] ❌ error:', error.details || error.message);
    if (error.details) {
      return res.status(500).json({ error: 'Failed to update escrow status', details: error.details });
    }
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = { releaseFundsHandler };