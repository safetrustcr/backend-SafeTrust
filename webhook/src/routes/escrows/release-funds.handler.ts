import { Request, Response } from 'express';
import { badRequest, conflict, duplicate, notFound, ok, serverError } from '../../utils/response';
import { ReleaseFundsPayload } from '@safetrust/types';
import {
  releaseFundsTransactional,
  EscrowNotFoundError,
  EscrowStateConflictError,
} from '../../services/escrow.service';
import {
  notifyHotelEscrowConversation,
} from '../../services/hotel-conversation-notify';

export const releaseFundsHandler = async (
  req: Request<{}, {}, ReleaseFundsPayload>,
  res: Response
): Promise<Response> => {
  const { contractId, releaseSigner } = req.body;

  if (!contractId || !releaseSigner) {
    return badRequest(res, {
      error: 'Missing required fields: contractId, releaseSigner',
    });
  }

  try {
    // 1 — Atomic lifecycle transaction: claim event + update escrow + mirror reservation
    const result = await releaseFundsTransactional(
      contractId,
      req.body as unknown as Record<string, unknown>
    );

    if (result.isDuplicate) {
      return duplicate(res, result.eventId);
    }

    // 2 — Notifications outside transaction commit (best-effort, non-fatal)
    try {
      await notifyHotelEscrowConversation({
        contractId,
        eventType: 'escrow_completed',
        body: 'SafeTrust: Funds have been released. Thank you for booking with us.',
      });
    } catch (notifyError) {
      console.warn(
        `[escrow/release-funds] Notification failed (non-fatal) for contractId ${contractId}:`,
        (notifyError as Error).message
      );
    }

    console.log(`[escrow/release-funds] ✅ Funds released — contractId: ${contractId}`);
    return ok(res);
  } catch (error) {
    if (error instanceof EscrowNotFoundError) {
      return notFound(res, { error: error.message });
    }

    if (error instanceof EscrowStateConflictError) {
      return conflict(res, { error: error.message });
    }

    const err = error as Error & { details?: unknown };
    console.error('[escrow/release-funds] ❌ error:', err.details || err.message);
    if (err.details) {
      return serverError(res, { error: 'Failed to update escrow status', details: err.details });
    }
    return serverError(res, { error: 'Internal server error', details: err.message });
  }
};
