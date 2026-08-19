'use strict';

const {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} = require('../../services/hasura');

const EVENT_TYPE = 'escrow.resolved';

const resolveDisputeHandler = async (req, res) => {
  const { contractId, resolver, resolutionNote } = req.body;

  if (!contractId || !resolver) {
    return res.status(400).json({
      error: 'Missing required fields: contractId, resolver'
    });
  }

  try {
    // 1 — Idempotency check
    const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
      contractId,
      EVENT_TYPE,
      req.body
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId);
      return res.status(200).json({ received: true });
    }

    // 2 — Update trustless_work_escrows
    const mutation = `
      mutation ResolveDispute($contractId: String!) {
        update_trustless_work_escrows(
          where: {
            contractId: { _eq: $contractId }
            status: { _eq: "disputed" }
          }
          _set: {
            status: "resolved"
            balance: 0
          }
        ) {
          returning { id contractId status balance }
        }
      }
    `;

    const data = await hasuraRequest(mutation, { contractId });
    const updated = data.update_trustless_work_escrows?.returning;

    if (!updated || !updated.length) {
      return res.status(404).json({
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    const escrowId = updated[0].id;

    // 3 — Mirror status to public.reservations
    const mirrorMutation = `
      mutation MirrorResolvedToReservation($escrowId: uuid!) {
        update_safetrust_reservations(
          where: { escrowId: { _eq: $escrowId } }
          _set: {
            status: "resolved"
            updatedAt: "now()"
          }
        ) {
          returning { id status }
        }
      }
    `;

    await hasuraRequest(mirrorMutation, { escrowId });

    // 4 — Store resolution note in escrow_metadata if provided
    if (resolutionNote) {
      const metadataMutation = `
        mutation AppendResolutionNote($contractId: String!, $note: jsonb!) {
          update_trustless_work_escrows(
            where: { contractId: { _eq: $contractId } }
            _append: { escrowMetadata: $note }
          ) {
            affected_rows
          }
        }
      `;

      await hasuraRequest(metadataMutation, {
        contractId,
        note: {
          resolver,
          resolutionNote,
          resolvedAt: new Date().toISOString(),
        },
      });
    }

    await markWebhookEventProcessed(eventId);

    console.log(`[escrow/resolve-dispute] ✅ Dispute resolved — contractId: ${contractId}, resolver: ${resolver}`);
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[escrow/resolve-dispute] ❌ error:', error.details || error.message);
    if (error.details) {
      return res.status(500).json({ error: 'Failed to update escrow status', details: error.details });
    }
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = { resolveDisputeHandler };