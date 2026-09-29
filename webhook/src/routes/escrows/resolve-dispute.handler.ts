import { Request, Response } from 'express';
import { badRequest, duplicate, notFound, ok, serverError } from '../../utils/response'
import { ResolveDisputePayload } from '@safetrust/types';
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../repositories/webhook-event.repository';
import {
  resolveDispute,
  appendResolutionNote,
} from '../../repositories/escrow.repository';
import {
  mirrorReservationStatus,
} from '../../repositories/reservation.repository';

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
    return badRequest(res, {
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
      return duplicate(res, eventId);
    }

    // 2 — Update trustless_work_escrows
    const validStates: string[] = JSON.parse(
      getValidPriorStates('resolved', 'dispute.resolved') as string
    );

    const updated = await resolveDispute(contractId, validStates);

    if (!updated) {
      return notFound(res, {
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    const escrowId = updated.id;

    // 3 — Mirror status to public.reservations
    await mirrorReservationStatus(escrowId, 'resolved');

    // 4 — Store resolution note in escrow_metadata if provided
    if (resolutionNote) {
      await appendResolutionNote(contractId, {
        resolver,
        resolutionNote,
        resolvedAt: new Date().toISOString(),
      });
    }

    await markWebhookEventProcessed(eventId);

    console.log(`[escrow/resolve-dispute] ✅ Dispute resolved — contractId: ${contractId}, resolver: ${resolver}`);
    return ok(res);

  } catch (error) {
    const err = error as Error & { details?: unknown };
    console.error('[escrow/resolve-dispute] ❌ error:', err.details || err.message);
    if (err.details) {
      return serverError(res, { error: 'Failed to update escrow status', details: err.details });
    }
    return serverError(res, { error: 'Internal server error', details: err.message });
  }
};
