import { Request, Response } from 'express';
import { badRequest, duplicate, notFound, ok, serverError } from '../../utils/response'
import { DisputeEscrowPayload } from '@safetrust/types';
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../repositories/webhook-event.repository';
import {
  disputeEscrow,
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

const EVENT_TYPE = EscrowEventType.DisputeOpened;

export const disputeEscrowHandler = async (
  req: Request<{}, {}, DisputeEscrowPayload>,
  res: Response
): Promise<Response> => {
  const { contractId, disputeFlag, disputer } = req.body;

  if (!contractId || disputeFlag === undefined || !disputer) {
    return badRequest(res, {
      error: 'Missing required fields: contractId, disputeFlag, disputer'
    });
  }

  if (disputeFlag !== true) {
    return badRequest(res, {
      error: 'disputeFlag must be true to open a dispute'
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
      getValidPriorStates(EscrowStatus.Disputed, EscrowEventType.DisputeOpened) as string
    );

    // On a retry the escrow may already be in the target state from the failed
    // attempt; accept it so the reservation mirror can be completed.
    const updated = await disputeEscrow(
      contractId,
      isRetry ? [...validStates, EscrowStatus.Disputed] : validStates
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
    await mirrorReservationStatus(escrowId, 'disputed', updated.tenantId);

    await markWebhookEventProcessed(eventId);

    console.log(`[escrow/dispute] ✅ Dispute opened — contractId: ${contractId}, disputer: ${disputer}`);
    return ok(res);

  } catch (error) {
    const err = error as Error & { details?: unknown };
    console.error('[escrow/dispute] ❌ error:', err.details || err.message);
    if (err.details) {
      return serverError(res, { error: 'Failed to update escrow status', details: err.details });
    }
    return serverError(res, { error: 'Internal server error', details: err.message });
  }
};
