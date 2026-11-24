
import { Request, Response } from 'express';
import { badRequest, conflict, duplicate, notFound, ok, serverError } from '../../utils/response';
import { ReleaseFundsPayload } from '../../domain';
import {
  releaseFundsTransactional,
  EscrowNotFoundError,
  EscrowStateConflictError,
} from '../../services/escrow.service';
import {
  notifyHotelEscrowConversation,
} from '../../services/hotel-conversation-notify';
import { logger } from '../../middleware/logger';

/**
 * Handles the escrow release-funds webhook event.
 * Atomically transitions the escrow to 'completed', mirrors reservation status,
 * and notifies hotel conversation. Supports idempotent retry if already completed.
 *
 * @param req - Express request containing ReleaseFundsPayload
 * @param res - Express response object
 * @returns Express response indicating success, duplicate, conflict, or error
 */
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
      logger.warn('escrow.release_funds.notification_failed', { contractId, error: notifyError });
    }

    logger.info('escrow.release_funds.succeeded', { contractId });
    return ok(res);
  } catch (error) {
    if (error instanceof EscrowNotFoundError) {
      return notFound(res, { error: error.message });
    }

    if (error instanceof EscrowStateConflictError) {
      return conflict(res, { error: error.message });
    }

    logger.error('escrow.release_funds.failed', { contractId, error });
    return serverError(res, 'Failed to update escrow status');
  }
};
