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

  try {
    const endpoint = process.env.HASURA_GRAPHQL_ENDPOINT;
    const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET;

    if (!endpoint) {
      console.error('[escrow/dispute] HASURA_GRAPHQL_ENDPOINT is not configured');
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
      console.error('[escrow/dispute] Hasura error:', hasuraData.errors);
      return res.status(500).json({ error: 'Failed to update escrow status', details: hasuraData.errors });
    }

    const updated = hasuraData.data?.update_trustless_work_escrows?.returning;
    if (!updated || !updated.length) {
      return res.status(404).json({ error: `Escrow not found for contractId: ${contractId}` });
    }

    console.log(`[escrow/dispute] Dispute opened — contractId: ${contractId}, disputer: ${disputer}`);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[escrow/dispute] Exception:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = { disputeEscrowHandler };
