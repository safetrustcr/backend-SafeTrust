import { Request, Response } from 'express';
import { badRequest, duplicate, notFound, ok, serverError } from '../../utils/response'
import { FundEscrowPayload } from '@safetrust/types';
import { processWebhookEvent } from '../../repositories/webhook-event.repository';
import {
  fundEscrowInTransaction,
} from '../../repositories/escrow.repository';
import {
  mirrorReservationStatusInTransaction,
} from '../../repositories/reservation.repository';
import {
  notifyHotelEscrowConversation,
} from '../../services/hotel-conversation-notify';
import { EscrowEventType, EscrowStatus } from '../../types/escrow.types';

// Compile-time SafeTrust escrow state machine (Neon native addon).
// Replaces hardcoded status arrays with the authoritative transition table.
const { getValidPriorStates } = require('../../../../crates/escrow-state-machine') as {
  getValidPriorStates: (to: string, event: string) => string
}

const EVENT_TYPE = EscrowEventType.Funded;

export const fundEscrowHandler = async (
  req: Request<{}, {}, FundEscrowPayload>,
  res: Response
): Promise<Response> => {
  const { contractId, signer, amount } = req.body;

  // 1 — Validate required fields
  if (!contractId || !signer || amount === undefined || amount === null) {
    return badRequest(res, {
      error: 'Missing required fields: contractId, signer, amount'
    });
  }

  if (amount <= 0) {
    return badRequest(res, {
      error: 'Amount cannot be zero or negative'
    });
  }

  try {
    // 2 — Claim the event and apply database state changes atomically
    const { isDuplicate, eventId, result: updated } = await processWebhookEvent(
      contractId,
      EVENT_TYPE,
      req.body as unknown as Record<string, unknown>,
      async (client) => {
        const validStates: string[] = JSON.parse(
          getValidPriorStates(EscrowStatus.Funded, EscrowEventType.Funded) as string
        );
        const escrow = await fundEscrowInTransaction(
          client,
          contractId,
          amount,
          validStates
        );

        if (escrow) {
          await mirrorReservationStatusInTransaction(client, escrow.id, 'funded')
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

    // 3 — Notify hotel conversation after the state transaction commits
    await notifyHotelEscrowConversation({
      contractId,
      eventType: 'escrow_funded',
      body: 'SafeTrust: Your deposit has been confirmed on the Stellar network. Your booking is secured.',
    });

    console.log(`[escrow/fund] ✅ Escrow funded — contractId: ${contractId}`);
    return ok(res);

  } catch (error) {
    const err = error as Error & { details?: unknown };
    console.error('[escrow/fund] ❌ error:', err.details || err.message);
    if (err.details) {
      return serverError(res, { error: 'Failed to update escrow status', details: err.details });
    }
    return serverError(res, { error: 'Internal server error' });
  }
};
