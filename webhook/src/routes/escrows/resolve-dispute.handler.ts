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
import { EscrowEventType, EscrowStatus } from '../../types/escrow.types';

// Compile-time SafeTrust escrow state machine (Neon native addon).
// Replaces hardcoded status strings with the authoritative transition table.
const { getValidPriorStates } = require('../../../../crates/escrow-state-machine') as {
  getValidPriorStates: (to: string, event: string) => string
}

const EVENT_TYPE = EscrowEventType.DisputeResolved;

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
    const { isDuplicate, eventId, alreadyProcessed } = await logAndCheckWebhookEvent(
      contractId,
      EVENT_TYPE,
      req.body as unknown as Record<string, unknown>
    );

    // Only acknowledge a duplicate that was fully processed. An earlier attempt
    // that failed (e.g. reservation mirror) is retried below.
    if (isDuplicate && alreadyProcessed) {
      return duplicate(res, eventId);
    }
    const isRetry = isDuplicate;

    // 2 — Update trustless_work_escrows
    const validStates: string[] = JSON.parse(
      getValidPriorStates(EscrowStatus.Resolved, EscrowEventType.DisputeResolved) as string
    );

    // On a retry the escrow may already be in the target state from the failed
    // attempt; accept it so the reservation mirror can be completed.
    const updated = await resolveDispute(
      contractId,
      isRetry ? [...validStates, EscrowStatus.Resolved] : validStates
    );

    if (!updated) {
      return notFound(res, {
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    const escrowId = updated.id;

    // 3 — Mirror status to safetrust.reservations
    // Scope the mirror to the tenant that owns the escrow record.
    if (!updated.tenantId) {
      throw new Error(`Escrow ${escrowId} has no tenant; refusing to mirror reservation status`);
    }
    await mirrorReservationStatus(escrowId, 'resolved', updated.tenantId);

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
