import { Request, Response } from 'express';
import { ReleaseFundsPayload } from '@safetrust/types';
import {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../services/hasura';
import {
  notifyHotelEscrowConversation,
} from '../../services/hotel-conversation-notify';

const EVENT_TYPE = 'escrow.completed';

export const releaseFundsHandler = async (
  req: Request<{}, {}, ReleaseFundsPayload>,
  res: Response
): Promise<Response> => {
  const { contractId, releaseSigner } = req.body;

  if (!contractId || !releaseSigner) {
    return res.status(400).json({
      error: 'Missing required fields: contractId, releaseSigner'
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
    const mutation = `
      mutation ReleaseFunds($contractId: String!) {
        update_trustless_work_escrows(
          where: { contractId: { _eq: $contractId } }
          _set: {
            status: "completed"
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
    }>(mutation, { contractId });
    const updated = data.update_trustless_work_escrows?.returning;

    if (!updated || !updated.length) {
      return res.status(404).json({
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    const escrowId = updated[0].id;

    // 3 — Mirror status to public.reservations
    const mirrorMutation = `
      mutation MirrorCompletedToReservation($escrowId: uuid!) {
        update_reservations(
          where: { escrowId: { _eq: $escrowId } }
          _set: {
            status: "completed"
            updatedAt: "now()"
          }
        ) {
          returning { id status }
        }
      }
    `;

    await hasuraRequest(mirrorMutation, { escrowId });

    // 4 — Notify hotel conversation (best-effort, never fail the response)
    await notifyHotelEscrowConversation({
      contractId,
      eventType: 'escrow_completed',
      body: 'SafeTrust: Funds have been released. Thank you for booking with us.',
    });

    await markWebhookEventProcessed(eventId);

    console.log(`[escrow/release-funds] ✅ Funds released — contractId: ${contractId}`);
    return res.status(200).json({ received: true });

  } catch (error) {
    const err = error as Error & { details?: unknown };
    console.error('[escrow/release-funds] ❌ error:', err.details || err.message);
    if (err.details) {
      return res.status(500).json({ error: 'Failed to update escrow status', details: err.details });
    }
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
};
