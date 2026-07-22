const {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} = require('../../services/hasura');

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

    const endpoint = process.env.HASURA_GRAPHQL_ENDPOINT;
    const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET;

    if (!endpoint) {
      console.error('[escrow/release-funds] HASURA_GRAPHQL_ENDPOINT is not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const hasuraRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(adminSecret ? { 'x-hasura-admin-secret': adminSecret } : {}),
      },
      body: JSON.stringify({ query: mutation, variables: { contractId } }),
    });

    const hasuraData = await hasuraRes.json();
    
    if (hasuraData.errors) {
      console.error('[escrow/release-funds] Hasura error:', hasuraData.errors);
      return res.status(500).json({ error: 'Failed to update escrow status', details: hasuraData.errors });
    }
    
    const updated = hasuraData.data?.update_trustless_work_escrows?.returning;

    if (!updated || !updated.length) {
      return res.status(404).json({ error: `Escrow not found for contractId: ${contractId}` });
    }

    console.log(`[escrow/release-funds] Funds released — contractId: ${contractId}`);
    await markWebhookEventProcessed(eventId);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[escrow/release-funds] Exception:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = { releaseFundsHandler };
