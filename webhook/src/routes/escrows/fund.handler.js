const {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} = require('../../services/hasura');
const {
  notifyHotelEscrowConversation,
} = require('../../services/hotel-conversation-notify');

const EVENT_TYPE = 'escrow.funded';

const fundEscrowHandler = async (req, res) => {
  const { contractId, signer, amount } = req.body;

  // 1 — Validate required fields
  if (!contractId || !signer || amount === undefined || amount === null) {
    return res.status(400).json({
      error: 'Missing required fields: contractId, signer, amount'
    });
  }

  if (amount <= 0) {
    return res.status(400).json({
      error: 'Amount cannot be zero or negative'
    });
  }

  try {
    // 2 — Idempotency check via webhook event log
    const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
      contractId,
      EVENT_TYPE,
      req.body
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId);
      return res.status(200).json({ received: true });
    }

    // 3 — Update safetrust.trustless_work_escrows
    const mutation = `
      mutation FundEscrow($contractId: String!, $amount: numeric!) {
        update_trustless_work_escrows(
          where: {
            contractId: { _eq: $contractId }
            status: { _in: ["created", "pending_funding"] }
          }
          _set: {
            status: "funded"
            balance: $amount
          }
        ) {
          returning {
            id
            contractId
            status
            balance
          }
        }
      }
    `;

    const data = await hasuraRequest(mutation, { contractId, amount });
    const updated = data.update_trustless_work_escrows?.returning;

    if (!updated || !updated.length) {
      return res.status(404).json({
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    // 4 — Mirror status to safetrust.reservations
    const mirrorMutation = `
      mutation MirrorFundedToReservation($contractId: String!) {
        update_reservations(
          where: { escrow: { contractId: { _eq: $contractId } } }
          _set: {
            status: "funded"
            updated_at: "now()"
          }
        ) {
          returning { id status }
        }
      }
    `;

    await hasuraRequest(mirrorMutation, { contractId });

    // 5 — Notify hotel conversation (best-effort, never fail the response)
    await notifyHotelEscrowConversation({
      contractId,
      eventType: 'escrow_funded',
      body: 'SafeTrust: Your deposit has been confirmed on the Stellar network. Your booking is secured.',
    });

    await markWebhookEventProcessed(eventId);

    console.log(`[escrow/fund] ✅ Escrow funded — contractId: ${contractId}`);
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[escrow/fund] ❌ error:', error.details || error.message);
    if (error.details) {
      return res.status(500).json({ error: 'Failed to update escrow status' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { fundEscrowHandler };