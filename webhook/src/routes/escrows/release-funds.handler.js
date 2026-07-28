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

  const mutation = `
    mutation ReleaseFunds($contractId: String!) {
      update_trustless_work_escrows(
        where: { contractId: { _eq: $contractId } }
        _set: {
          status: "completed",
          balance: 0
        }
      ) {
        returning { id contractId status balance }
      }
    }
  `;

  try {
    const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
      contractId,
      EVENT_TYPE,
      req.body
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId);
      return res.status(200).json({ received: true });
    }

    const data = await hasuraRequest(mutation, { contractId });
    const updated = data.update_trustless_work_escrows?.returning;

    if (!updated || !updated.length) {
      return res.status(404).json({ error: `Escrow not found for contractId: ${contractId}` });
    }

    console.log(`[escrow/release-funds] ✅ funds released — contractId: ${contractId}`);

    // Best-effort hotel lifecycle message — never fail the release response
    await notifyHotelEscrowConversation({
      contractId,
      eventType: 'escrow_completed',
      body:
        'SafeTrust: Funds have been released. Thank you for booking with us.',
    });

    await markWebhookEventProcessed(eventId);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[escrow/release-funds] Hasura error:', error.details || error.message);
    if (error.details) {
      return res.status(500).json({ error: 'Failed to update escrow status', details: error.details });
    }
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = { releaseFundsHandler };
