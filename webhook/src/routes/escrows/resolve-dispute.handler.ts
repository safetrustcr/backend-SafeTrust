import { Request, Response } from 'express';
import { ResolveDisputePayload } from '@safetrust/types';
import {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../services/hasura';

// Compile-time SafeTrust escrow state machine (Neon native addon).
// Replaces hardcoded status strings with the authoritative transition table.
const { getValidPriorStates } = require('../../../../crates/escrow-state-machine') as {
  getValidPriorStates: (to: string, event: string) => string
}

const EVENT_TYPE = 'escrow.resolved';

export const resolveDisputeHandler = async (
  req: Request<{}, {}, ResolveDisputePayload>,
  res: Response
): Promise<Response> => {
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
      req.body as unknown as Record<string, unknown>
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId);
      return res.status(200).json({ received: true });
    }

    // 2 — Update trustless_work_escrows
    // Valid prior states are driven by the Rust state machine, replacing the
    // previously hardcoded status: { _eq: "disputed" } guard.
    const validStates: string[] = JSON.parse(
      getValidPriorStates('resolved', 'dispute.resolved') as string
    );

    const mutation = `
      mutation ResolveDispute($contractId: String!, $validStates: [String!]!) {
        update_trustless_work_escrows(
          where: {
            contractId: { _eq: $contractId }
            status: { _in: $validStates }
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

    const data = await hasuraRequest<{
      update_trustless_work_escrows?: {
        returning: Array<{ id: string; contractId: string; status: string; balance: number }>;
      };
    }>(mutation, { contractId, validStates });
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
        update_reservations(
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
    const err = error as Error & { details?: unknown };
    console.error('[escrow/resolve-dispute] ❌ error:', err.details || err.message);
    if (err.details) {
      return res.status(500).json({ error: 'Failed to update escrow status', details: err.details });
    }
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
};
