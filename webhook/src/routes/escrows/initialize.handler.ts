import { Request, Response } from 'express';
import { duplicate, ok } from '../../utils/response';
import { AuthError, ValidationError } from '../../utils/errors';
import { initializeEscrow as initializeEscrowService } from '../../services/escrow.service';
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
    throw new ValidationError('amount must be a positive finite numeric value');
  }

  const callerUserId = (req as any).user?.uid || (req as any).user?.id;
  const isServerAgent = Boolean((req as any).isAgent);
  const hasPaymentSignature = Boolean(req.headers?.['payment-signature']);

  if (!callerUserId && !isServerAgent && !hasPaymentSignature) {
    throw new AuthError('Authentication required: caller identity must be verified');
  }

  const context = callerUserId || isServerAgent ? { callerUserId, isServerAgent } : undefined;
  const result = await initializeEscrowService(req.body, getPlatformTenantId(), context);

  if (result.isDuplicate) {
    return duplicate(res, result.eventId);
  }

  logger.info('escrow.initialize.succeeded', {
    contractId: req.body.contract_id,
    escrowId: result.escrow?.id,
  });
  return ok(res);
};
