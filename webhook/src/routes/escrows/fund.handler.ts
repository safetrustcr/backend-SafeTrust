import { Request, Response } from 'express';
import { badRequest, conflict, duplicate, notFound, ok, serverError } from '../../utils/response';
import { FundEscrowPayload } from '@safetrust/types';
import {
  fundEscrowTransactional,
  EscrowNotFoundError,
  EscrowStateConflictError,
} from '../../services/escrow.service';
import {
  notifyHotelEscrowConversation,
} from '../../services/hotel-conversation-notify';

export const fundEscrowHandler = async (
  req: Request<{}, {}, FundEscrowPayload>,
  res: Response
): Promise<Response> => {
  const { contractId, signer, amount } = req.body;

  // 1 — Validate required fields
  if (!contractId || !signer || amount === undefined || amount === null) {
    return badRequest(res, {
      error: 'Missing required fields: contractId, signer, amount',
    });
  }

  if (amount <= 0) {
    return badRequest(res, {
      error: 'Amount cannot be zero or negative',
    });
  }

  try {
    // 2 — Atomic lifecycle transaction: claim event + update escrow + mirror reservation
    const result = await fundEscrowTransactional(
      contractId,
      amount,
      req.body as unknown as Record<string, unknown>
    );

    if (result.isDuplicate) {
      return duplicate(res, result.eventId);
    }

    // 3 — Notifications outside transaction commit (best-effort, non-fatal)
    try {
      await notifyHotelEscrowConversation({
        contractId,
        eventType: 'escrow_funded',
        body: 'SafeTrust: Your deposit has been confirmed on the Stellar network. Your booking is secured.',
      });
    } catch (notifyError) {
      console.warn(
        `[escrow/fund] Notification failed (non-fatal) for contractId ${contractId}:`,
        (notifyError as Error).message
      );
    }

    console.log(`[escrow/fund] ✅ Escrow funded — contractId: ${contractId}`);
    return ok(res);
  } catch (error) {
    if (error instanceof EscrowNotFoundError) {
      return notFound(res, { error: error.message });
    }

    if (error instanceof EscrowStateConflictError) {
      return conflict(res, { error: error.message });
    }

    const err = error as Error & { details?: unknown };
    console.error('[escrow/fund] ❌ error:', err.details || err.message);
    if (err.details) {
      return serverError(res, { error: 'Failed to update escrow status', details: err.details });
    }
    return serverError(res, { error: 'Internal server error' });
  }
};
