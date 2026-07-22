const {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} = require('../../services/hasura');

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

  // 2 — Update public.trustless_work_escrows via Hasura GraphQL mutation
  const mutation = `
    mutation FundEscrow($contractId: String!, $amount: numeric!) {
      update_trustless_work_escrows(
        where: {
          contractId: { _eq: $contractId },
          status: { _in: ["created", "pending_funding"] }
        }
        _set: {
          status: "funded",
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
      console.error('[escrow/fund] HASURA_GRAPHQL_ENDPOINT is not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const hasuraRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(adminSecret ? { 'x-hasura-admin-secret': adminSecret } : {}),
      },
      body: JSON.stringify({
        query: mutation,
        variables: { contractId, amount }
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const hasuraData = await hasuraRes.json();

    if (hasuraData.errors) {
      console.error('[escrow/fund] Hasura error:', hasuraData.errors);
      return res.status(500).json({
        error: 'Failed to update escrow status'
      });
    }

    const updated = hasuraData.data?.update_trustless_work_escrows?.returning;

    if (!updated || !updated.length) {
      return res.status(404).json({
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    console.log(`[escrow/fund] Escrow funded — contractId: ${contractId}, amount: ${amount}`);

    await markWebhookEventProcessed(eventId);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[escrow/fund] Exception:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { fundEscrowHandler };
