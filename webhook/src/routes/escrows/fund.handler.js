const {
  hasuraRequest,
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

    const data = await hasuraRequest(mutation, { contractId, amount });
    const updated = data.update_trustless_work_escrows?.returning;

    if (!updated || !updated.length) {
      return res.status(404).json({
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    console.log(`[escrow/fund] Escrow funded — contractId: ${contractId}, amount: ${amount}`);

    await markWebhookEventProcessed(eventId);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[escrow/fund] Hasura error:', error.details || error.message);
    if (error.details) {
      return res.status(500).json({ error: 'Failed to update escrow status' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { fundEscrowHandler };
