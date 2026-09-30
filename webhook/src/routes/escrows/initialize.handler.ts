import { Request, Response } from 'express';
import { badRequest, duplicate, ok, serverError, serviceUnavailable } from '../../utils/response'
import { InitializeEscrowPayload } from '@safetrust/types';
import {
  validateEscrowInitializationPayload,
  initializeEscrow,
  EscrowValidationError,
  ZkVerifierUnavailableError,
} from '../../services/escrow.service';

// Re-export so existing consumers (tests, etc.) that import amountToStroops
// from this module continue to work without changes.
export { amountToStroops } from '../../lib/stellar-amounts';

export const initializeEscrowHandler = async (
  req: Request<{}, {}, InitializeEscrowPayload>,
  res: Response
): Promise<Response> => {

  // 1 — Validate and normalize payload (throws on invalid input)
  let payload;
  try {
    payload = validateEscrowInitializationPayload(req.body);
  } catch (err) {
    if (err instanceof ZkVerifierUnavailableError) {
      return res.status(503).json({ error: err.message });
    }
    if (err instanceof EscrowValidationError) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    const error = err as Error;
    return res.status(400).json({ error: error.message });
  }

  try {
    // 2 — Process idempotency, persistence, and reservation linking
    const result = await initializeEscrow(
      payload,
      req.body as unknown as Record<string, unknown>
    );

    if (result.isDuplicate) {
      return duplicate(res, result.eventId);
    }

    const escrow = result.escrow!;
    console.log(
      `[escrow/initialize] ✅ Escrow persisted — contract_id: ${payload.contract_id}, id: ${escrow.id}`
    );
    return ok(res);

  } catch (error) {
    const err = error as Error & { details?: unknown };
    console.error('[escrow/initialize] ❌ Error:', err.details || err.message);
    if (err.details) {
      return serverError(res, { error: 'Failed to persist escrow record', details: err.details });
    }
    return serverError(res, { error: 'Internal server error', details: err.message });
  }
};
