import { Request, Response } from 'express';
import {
  badRequest,
  duplicate,
  notFound,
  ok,
  serverError,
  serviceUnavailable,
} from '../../utils/response'
import {
  EscrowValidationError,
  initializeEscrow as initializeEscrowService,
  ReservationNotFoundError,
  TenantMismatchError,
  ZkVerifierUnavailableError,
} from '../../services/escrow.service';
import { amountToStroops } from '../../lib/stellar-amounts';
import { getPlatformTenantId } from '../../config/tenant';

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

    console.log(
      `[escrow/initialize] Escrow persisted — contract_id: ${req.body.contract_id}, id: ${result.escrow?.id}`
    );
    return ok(res);
  } catch (error) {
    if (error instanceof EscrowValidationError) {
      return error.statusCode === 400
        ? badRequest(res, { error: error.message })
        : serverError(res, { error: error.message });
    }
    if (error instanceof ZkVerifierUnavailableError) {
      return serviceUnavailable(res, { error: error.message });
    }
    if (error instanceof ReservationNotFoundError) {
      return notFound(res, { error: error.message });
    }
    if (error instanceof TenantMismatchError) {
      return res.status(403).json({ success: false, error: 'Forbidden: tenant mismatch' });
    }

    const err = error as Error & { details?: unknown };
    console.error('[escrow/initialize] Error:', err.details || err.message);
    if (err.details) {
      return serverError(res, { error: 'Failed to persist escrow record', details: err.details });
    }
    return serverError(res, { error: 'Internal server error', details: err.message });
  }
};
