const initializeEscrowHandler = async (req, res) => {
  const {
    contract_id,
    marker,
    approver,
    releaser,
    resolver,
    amount,
    escrow_type,
    asset_code,
    asset_issuer,
    booking_id,
    room_id,
    hotel_id,
    guest_id,
    booking_metadata,
  } = req.body;

  // 1 — Validate required fields
  if (!contract_id || !marker || !approver || !releaser || !amount || !escrow_type) {
    return res.status(400).json({
      error: 'Missing required fields: contract_id, marker, approver, releaser, amount, escrow_type'
    });
  }

  // 2 — Validate escrow_type matches migration CHECK constraint
  const validTypes = ['single_release', 'multi_release'];
  if (!validTypes.includes(escrow_type)) {
    return res.status(400).json({
      error: `escrow_type must be one of: ${validTypes.join(', ')}`
    });
  }

  // 3 — Persist to public.trustless_work_escrows via Hasura GraphQL mutation
  const mutation = `
    mutation InitializeEscrow($object: trustless_work_escrows_insert_input!) {
      insert_trustless_work_escrows_one(object: $object) {
        id
        contract_id
        status
        created_at
      }
    }
  `;

  try {
    const endpoint = process.env.HASURA_GRAPHQL_ENDPOINT;
    const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET;

    if (!endpoint) {
      console.error('[escrow/initialize] HASURA_GRAPHQL_ENDPOINT is not configured');
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
        variables: {
          object: {
            contract_id,
            marker,
            approver,
            releaser,
            resolver: resolver || null,
            escrow_type,
            status: 'created',             // initial status per valid_escrow_status CHECK
            asset_code: asset_code || 'USDC',
            asset_issuer: asset_issuer || null,
            amount,
            balance: 0,
            booking_id: booking_id || null,
            room_id: room_id || null,
            hotel_id: hotel_id || null,
            guest_id: guest_id || null,
            tenant_id: 'safetrust',
            escrow_metadata: req.body,     // full payload stored as JSONB
            booking_metadata: booking_metadata || null,
          }
        }
      }),
    });

    const hasuraData = await hasuraRes.json();

    if (hasuraData.errors) {
      console.error('[escrow/initialize] Hasura error:', hasuraData.errors);
      return res.status(500).json({
        error: 'Failed to persist escrow record',
        details: hasuraData.errors
      });
    }

    const escrow = hasuraData.data?.insert_trustless_work_escrows_one;
    if (!escrow) {
      return res.status(500).json({ error: 'Failed to insert escrow record' });
    }

    console.log(`[escrow/initialize] Escrow persisted — contract_id: ${contract_id}, id: ${escrow.id}`);

    // 4 — Acknowledge TrustlessWork webhook
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[escrow/initialize] Exception:', error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = { initializeEscrowHandler };
