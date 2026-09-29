import { Request, Response } from 'express';
import { badRequest, duplicate, notFound, ok, serverError } from '../../utils/response'
import { ReleaseFundsPayload } from '@safetrust/types';
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../repositories/webhook-event.repository';
import {
  releaseFunds,
} from '../../repositories/escrow.repository';
import {
  mirrorReservationStatus,
} from '../../repositories/reservation.repository';
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
    return badRequest(res, {
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
      return duplicate(res, eventId);
    }

    // 2 — Update trustless_work_escrows
    const updated = await releaseFunds(contractId);

    if (!updated) {
      return notFound(res, {
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    const escrowId = updated.id;

    // 3 — Mirror status to public.reservations
    await mirrorReservationStatus(escrowId, 'completed');

    // 4 — Notify hotel conversation (best-effort, never fail the response)
    await notifyHotelEscrowConversation({
      contractId,
      eventType: 'escrow_completed',
      body: 'SafeTrust: Funds have been released. Thank you for booking with us.',
    });

    await markWebhookEventProcessed(eventId);

    console.log(`[escrow/release-funds] ✅ Funds released — contractId: ${contractId}`);
    return ok(res);

  } catch (error) {
    const err = error as Error & { details?: unknown };
    console.error('[escrow/release-funds] ❌ error:', err.details || err.message);
    if (err.details) {
      return serverError(res, { error: 'Failed to update escrow status', details: err.details });
    }
    return serverError(res, { error: 'Internal server error', details: err.message });
  }
};
