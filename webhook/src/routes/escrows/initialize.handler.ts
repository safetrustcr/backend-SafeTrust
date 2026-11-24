import { Request, Response } from 'express';
import {
  badRequest,
  duplicate,
  forbidden,
  ok,
  sendError,
  serverError,
} from '../../utils/response'
import { AppError } from '../../utils/errors'
import {
  EscrowValidationError,
  initializeEscrow as initializeEscrowService,
  ReservationNotFoundError,
  TenantMismatchError,
} from '../../services/escrow.service';
import { amountToStroops } from '../../lib/stellar-amounts';
import { getPlatformTenantId } from '../../config/tenant';
import { logger } from '../../middleware/logger';

export { amountToStroops };

export const initializeEscrowHandler = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const amount = req.body?.amount;
  if (
    Object.prototype.hasOwnProperty.call(req.body ?? {}, 'amount') &&
    amountToStroops(amount) === null
  ) {
      return badRequest(res, {
        error: 'amount must be a positive finite numeric value',
      });
  }

  try {
    const result = await initializeEscrowService(req.body, getPlatformTenantId());

    if (result.isDuplicate) {
      return duplicate(res, result.eventId);
    }

    logger.info('escrow.initialize.succeeded', {
      contractId: req.body.contract_id,
      escrowId: result.escrow?.id,
    });
    return ok(res);
  } catch (error) {
    if (error instanceof TenantMismatchError) {
      return forbidden(res, { error: 'Forbidden: tenant mismatch', code: error.code });
    }
    if (error instanceof EscrowValidationError && error.statusCode === 400) {
      return badRequest(res, { error: error.message });
    }
    if (error instanceof AppError) {
      // Not found keeps its message; 5xx is logged and answered with a generic message.
      if (error.statusCode >= 500) {
        logger.error('escrow.initialize.failed', { contractId: req.body?.contract_id, error });
      }
      return sendError(res, error);
    }

    logger.error('escrow.initialize.failed', { contractId: req.body?.contract_id, error });
    return serverError(res, 'Failed to persist escrow record');
  }
};
