import { Request, Response } from 'express';
import { DisputeEscrowPayload } from '@safetrust/types';
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

const EVENT_TYPE = 'escrow.disputed';

export const disputeEscrowHandler = async (
  req: Request<{}, {}, DisputeEscrowPayload>,
  res: Response
): Promise<Response> => {
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
    // Valid prior states are driven by the Rust state machine, enforcing the
    // legal from-states for a dispute (funded | active | milestone_approved).
    const validStates: string[] = JSON.parse(
      getValidPriorStates('disputed', 'dispute.raised') as string
    );

    const mutation = `
      mutation DisputeEscrow($contractId: String!, $validStates: [String!]!) {
        update_trustless_work_escrows(
          where: {
            contractId: { _eq: $contractId }
            status: { _in: $validStates }
          }
          _set: {
            status: "disputed"
          }
        ) {
          returning { id contractId status }
        }
      }
    `;

    const data = await hasuraRequest<{
      update_trustless_work_escrows?: {
        returning: Array<{ id: string; contractId: string; status: string }>;
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
      mutation MirrorDisputedToReservation($escrowId: uuid!) {
        update_reservations(
          where: { escrowId: { _eq: $escrowId } }
          _set: {
            status: "disputed"
            updatedAt: "now()"
          }
        ) {
          returning { id status }
        }
      }
    `;

    await hasuraRequest(mirrorMutation, { escrowId });

    await markWebhookEventProcessed(eventId);

    console.log(`[escrow/dispute] ✅ Dispute opened — contractId: ${contractId}, disputer: ${disputer}`);
    return res.status(200).json({ received: true });

  } catch (error) {
    const err = error as Error & { details?: unknown };
    console.error('[escrow/dispute] ❌ error:', err.details || err.message);
    if (err.details) {
      return res.status(500).json({ error: 'Failed to update escrow status', details: err.details });
    }
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
};
