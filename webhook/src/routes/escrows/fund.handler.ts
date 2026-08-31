import { Request, Response } from 'express';
import { FundEscrowPayload } from '@safetrust/types';
import {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../services/hasura';
import {
  notifyHotelEscrowConversation,
} from '../../services/hotel-conversation-notify';

// Compile-time SafeTrust escrow state machine (Neon native addon).
// Replaces hardcoded status arrays with the authoritative transition table.
const { getValidPriorStates } = require('../../../../crates/escrow-state-machine') as {
  getValidPriorStates: (to: string, event: string) => string
}

const EVENT_TYPE = 'escrow.funded';

export const fundEscrowHandler = async (
  req: Request<{}, {}, FundEscrowPayload>,
  res: Response
): Promise<Response> => {
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

  try {
    // 2 — Idempotency check via webhook event log
    const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
      contractId,
      EVENT_TYPE,
      req.body as unknown as Record<string, unknown>
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId);
      return res.status(200).json({ received: true });
    }

    // 3 — Update public.trustless_work_escrows
    // Valid prior states are driven by the Rust state machine, replacing the
    // previously hardcoded _in: ["created", "pending_funding"].
    const validStates: string[] = JSON.parse(
      getValidPriorStates('funded', 'escrow.funded') as string
    );

    const mutation = `
      mutation FundEscrow($contractId: String!, $amount: numeric!, $validStates: [String!]!) {
        update_trustless_work_escrows(
          where: {
            contractId: { _eq: $contractId }
            status: { _in: $validStates }
          }
          _set: {
            status: "funded"
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

    const data = await hasuraRequest<{
      update_trustless_work_escrows?: {
        returning: Array<{ id: string; contractId: string; status: string; balance: number }>;
      };
    }>(mutation, { contractId, amount, validStates });
    const updated = data.update_trustless_work_escrows?.returning;

    if (!updated || !updated.length) {
      return res.status(404).json({
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    const escrowId = updated[0].id;

    // 4 — Mirror status to public.reservations
    const mirrorMutation = `
      mutation MirrorFundedToReservation($escrowId: uuid!) {
        update_reservations(
          where: { escrowId: { _eq: $escrowId } }
          _set: {
            status: "funded"
            updatedAt: "now()"
          }
        ) {
          returning { id status }
        }
      }
    `;

    await hasuraRequest(mirrorMutation, { escrowId });

    // 5 — Notify hotel conversation (best-effort, never fail the response)
    await notifyHotelEscrowConversation({
      contractId,
      eventType: 'escrow_funded',
      body: 'SafeTrust: Your deposit has been confirmed on the Stellar network. Your booking is secured.',
    });

    await markWebhookEventProcessed(eventId);

    console.log(`[escrow/fund] ✅ Escrow funded — contractId: ${contractId}`);
    return res.status(200).json({ received: true });

  } catch (error) {
    const err = error as Error & { details?: unknown };
    console.error('[escrow/fund] ❌ error:', err.details || err.message);
    if (err.details) {
      return res.status(500).json({ error: 'Failed to update escrow status', details: err.details });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};
