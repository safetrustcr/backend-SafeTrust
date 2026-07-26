const {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} = require('../../services/hasura');

const EVENT_TYPE = 'escrow.resolved';

const resolveDisputeHandler = async (req, res) => {
  const { contractId, resolver, resolutionNote } = req.body;

  // 1 — Validate required fields
  if (!contractId || !resolver) {
    return res.status(400).json({
      error: 'Missing required fields: contractId, resolver'
    });
  }

  // 2 — Update public.trustless_work_escrows via Hasura GraphQL mutation
  const mutation = `
    mutation ResolveDispute($contractId: String!) {
      update_trustless_work_escrows(
        where: {
          contractId: { _eq: $contractId },
          status: { _eq: "disputed" }
        }
        _set: {
          status: "resolved",
          balance: 0
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
      return res.status(404).json({
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    console.log(`[escrow/resolve-dispute] Dispute resolved — contractId: ${contractId}, resolver: ${resolver}`);

    await markWebhookEventProcessed(eventId);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[escrow/resolve-dispute] Hasura error:', error.details || error.message);
    if (error.details) {
      return res.status(500).json({ error: 'Failed to update escrow status', details: error.details });
    }
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = { resolveDisputeHandler };
