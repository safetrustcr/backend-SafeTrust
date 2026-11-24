import { Request, Response } from 'express';
import { badRequest, conflict, duplicate, notFound, ok, serverError } from '../../utils/response';
import { FundEscrowPayload } from '../../domain';
import {
  fundEscrowTransactional,
  EscrowNotFoundError,
  EscrowStateConflictError,
} from '../../services/escrow.service';
import {
  notifyHotelEscrowConversation,
} from '../../services/hotel-conversation-notify';
import { logger } from '../../middleware/logger';

/**
  * Handles the escrow funded webhook event.
  * Claims the event atomically, transitions the escrow to 'funded' if allowed,
  * mirrors reservation status, and notifies the hotel conversation.
  *
  * @param req - Express request containing the FundEscrowPayload
  * @param res - Express response object
  * @returns Express response indicating success, duplicate, or error
  */
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
      logger.warn('escrow.fund.notification_failed', { contractId, error: notifyError });
    }

    logger.info('escrow.fund.succeeded', { contractId });
    return ok(res);
  } catch (error) {
    if (error instanceof EscrowNotFoundError) {
      return notFound(res, { error: error.message });
    }

    if (error instanceof EscrowStateConflictError) {
      return conflict(res, { error: error.message });
    }

    logger.error('escrow.fund.failed', { contractId, error });
    return serverError(res, 'Failed to update escrow status');
  }
};
