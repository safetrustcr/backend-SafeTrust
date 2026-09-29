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
      getValidPriorStates('disputed', 'dispute.raised') as string
    );

    const updated = await disputeEscrow(contractId, validStates);

    if (!updated) {
      return notFound(res, {
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    const escrowId = updated.id;

    // 3 — Mirror status to public.reservations
    await mirrorReservationStatus(escrowId, 'disputed');

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
