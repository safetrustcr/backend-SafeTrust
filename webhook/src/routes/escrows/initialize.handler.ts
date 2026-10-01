import { Request, Response } from 'express';
import { badRequest, duplicate, ok, serverError, serviceUnavailable } from '../../utils/response'
import { InitializeEscrowPayload } from '@safetrust/types';
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../services/hasura';
import {
  validateEscrowInitializationPayload,
  persistEscrow,
  linkReservationToEscrow,
  EscrowValidationError,
  ZkVerifierUnavailableError,
} from '../../services/escrow.service';

// Re-export so existing consumers (tests, etc.) that import amountToStroops
// from this module continue to work without changes.
export { amountToStroops } from '../../lib/stellar-amounts';

const EVENT_TYPE = 'escrow.initialized';

export const initializeEscrowHandler = async (
  req: Request<{}, {}, InitializeEscrowPayload>,
  res: Response
): Promise<Response> => {

  // 1 — Validate and normalize payload (throws on invalid input)
  let payload;
  try {
    payload = validateEscrowInitializationPayload(req.body);
  } catch (err) {
    if (err instanceof ZkVerifierUnavailableError) {
      return res.status(503).json({ error: err.message });
    }
    if (err instanceof EscrowValidationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    const error = err as Error;
    return res.status(400).json({ error: error.message });
  }

  try {
    // 2 — Idempotency check
    const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
      payload.contract_id,
      EVENT_TYPE,
      req.body as unknown as Record<string, unknown>
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId);
      return duplicate(res, eventId);
    }

    // 3 — Persist escrow to DB
    const escrow = await persistEscrow(payload);

    // 4 — Optionally link to reservation
    const reservationId = payload.booking_metadata?.reservation_id;
    if (reservationId) {
      await linkReservationToEscrow(reservationId, escrow.id);
    }

    console.log(
      `[escrow/initialize] ✅ Escrow persisted — contract_id: ${payload.contract_id}, id: ${escrow.id}`
    );
    await markWebhookEventProcessed(eventId);
    return ok(res);

  } catch (error) {
    const err = error as Error & { details?: unknown };
    console.error('[escrow/initialize] ❌ Error:', err.details || err.message);
    if (err.details) {
      return serverError(res, { error: 'Failed to persist escrow record', details: err.details });
    }
    return serverError(res, { error: 'Internal server error', details: err.message });
  }
};
