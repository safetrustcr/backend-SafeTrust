const releaseFundsHandler = async (req, res) => {
  const { contractId, releaseSigner } = req.body;

  if (!contractId || !releaseSigner) {
    return res.status(400).json({
      error: 'Missing required fields: contractId, releaseSigner'
    });
  }

  // 1. Custom camelCase mutation (applied when metadata is fully loaded)
  const mutationCustom = `
    mutation ReleaseFunds($contractId: String!) {
      update_trustlessWorkEscrows(
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

  // 2. Default snake_case mutation (fallback for default tracked tables)
  const mutationDefault = `
    mutation ReleaseFunds($contractId: String!) {
      update_trustless_work_escrows(
        where: { contract_id: { _eq: $contractId } }
        _set: {
          status: "completed",
          balance: 0
        }
      ) {
        returning { id contract_id status balance }
      }
    }
  `;

  try {
    const endpoint = process.env.HASURA_GRAPHQL_ENDPOINT;
    const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET;

    if (!endpoint) {
      console.error('[escrow/release-funds] HASURA_GRAPHQL_ENDPOINT is not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Try custom mutation first
    let hasuraRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(adminSecret ? { 'x-hasura-admin-secret': adminSecret } : {}),
      },
      body: JSON.stringify({ query: mutationCustom, variables: { contractId } }),
    });

    let hasuraData = await hasuraRes.json();
    let updated;

    if (hasuraData.errors) {
      console.warn('[escrow/release-funds] Custom mutation failed, trying default mutation fallback...');
      
      // Fallback to default mutation
      hasuraRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminSecret ? { 'x-hasura-admin-secret': adminSecret } : {}),
        },
        body: JSON.stringify({ query: mutationDefault, variables: { contractId } }),
      });
      
      hasuraData = await hasuraRes.json();
      
      if (hasuraData.errors) {
        console.error('[escrow/release-funds] Hasura error (default mutation):', hasuraData.errors);
        return res.status(500).json({ error: 'Failed to update escrow status', details: hasuraData.errors });
      }
      
      updated = hasuraData.data?.update_trustless_work_escrows?.returning;
    } else {
      updated = hasuraData.data?.update_trustlessWorkEscrows?.returning;
    }

    if (!updated || !updated.length) {
      return res.status(404).json({ error: `Escrow not found for contractId: ${contractId}` });
    }

    console.log(`[escrow/release-funds] Funds released — contractId: ${contractId}`);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[escrow/release-funds] Exception:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = { releaseFundsHandler };
