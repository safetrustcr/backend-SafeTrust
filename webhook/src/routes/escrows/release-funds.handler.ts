import { Request, Response } from 'express';
import { badRequest, duplicate, notFound, ok, serverError } from '../../utils/response'
import { ReleaseFundsPayload } from '@safetrust/types';
import { processWebhookEvent } from '../../repositories/webhook-event.repository';
import {
  releaseFundsInTransaction,
} from '../../repositories/escrow.repository';
import {
  mirrorReservationStatusInTransaction,
} from '../../repositories/reservation.repository';
import {
  notifyHotelEscrowConversation,
} from '../../services/hotel-conversation-notify';
import { EscrowEventType, EscrowStatus } from '../../types/escrow.types';

const { getValidPriorStates } = require('../../../../crates/escrow-state-machine') as {
  getValidPriorStates: (to: string, event: string) => string
}

const EVENT_TYPE = EscrowEventType.FundsReleased;

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
    // 1 — Claim the event and apply database state changes atomically
    const { isDuplicate, eventId, result: updated } = await processWebhookEvent(
      contractId,
      EVENT_TYPE,
      req.body as unknown as Record<string, unknown>,
      async (client) => {
        const validStates: string[] = JSON.parse(
          getValidPriorStates(EscrowStatus.Completed, EscrowEventType.FundsReleased) as string
        );
        const escrow = await releaseFundsInTransaction(client, contractId, validStates)
        if (escrow) {
          await mirrorReservationStatusInTransaction(client, escrow.id, 'completed')
        }
        return escrow
      }
    );

    if (isDuplicate) {
      return duplicate(res, eventId);
    }

    if (!updated) {
      return notFound(res, {
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    const escrowId = updated.id;

    // 2 — Notify hotel conversation after the state transaction commits
    await notifyHotelEscrowConversation({
      contractId,
      eventType: 'escrow_completed',
      body: 'SafeTrust: Funds have been released. Thank you for booking with us.',
    });

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
