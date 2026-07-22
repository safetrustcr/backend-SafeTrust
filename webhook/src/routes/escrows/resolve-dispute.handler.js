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
    const endpoint = process.env.HASURA_GRAPHQL_ENDPOINT;
    const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET;

    if (!endpoint) {
      console.error('[escrow/resolve-dispute] HASURA_GRAPHQL_ENDPOINT is not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const hasuraRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(adminSecret ? { 'x-hasura-admin-secret': adminSecret } : {}),
      },
      body: JSON.stringify({
        query: mutation,
        variables: { contractId }
      }),
    });

    const hasuraData = await hasuraRes.json();

    if (hasuraData.errors) {
      console.error('[escrow/resolve-dispute] Hasura error:', hasuraData.errors);
      return res.status(500).json({
        error: 'Failed to update escrow status',
        details: hasuraData.errors
      });
    }

    const updated = hasuraData.data?.update_trustless_work_escrows?.returning;

    if (!updated || !updated.length) {
      return res.status(404).json({
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    console.log(`[escrow/resolve-dispute] Dispute resolved — contractId: ${contractId}, resolver: ${resolver}`);

    // 3 — Acknowledge TrustlessWork webhook
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[escrow/resolve-dispute] Exception:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = { resolveDisputeHandler };
