import { Request, Response } from 'express';
import { badRequest, duplicate, notFound, ok, serverError } from '../../utils/response'
import { DisputeEscrowPayload } from '@safetrust/types';
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../repositories/webhook-event.repository';
import {
  disputeEscrow,
} from '../../repositories/escrow.repository';
import {
  mirrorReservationStatus,
} from '../../repositories/reservation.repository';
import { getPlatformTenantId } from '../../config/tenant';
import { EscrowEventType, EscrowStatus } from '../../types/escrow.types';
import { getValidPriorStates } from '../../lib/escrow-transitions';
import { logger } from '../../middleware/logger';
import type { DisputeEscrowBody } from '../../validation';

const EVENT_TYPE = EscrowEventType.DisputeOpened;

/**
 * Handles the escrow dispute opened webhook event.
 * Validates payload, checks idempotency, transitions the escrow to 'disputed',
 * and mirrors the reservation status to disputed.
 *
 * @param req - Express request containing DisputeEscrowPayload
 * @param res - Express response object
 * @returns Express response indicating success, duplicate, or error
 */
export const disputeEscrowHandler = async (
  req: Request<{}, {}, DisputeEscrowBody>,
  res: Response
): Promise<Response> => {
  const { contractId, disputer } = req.body;

  try {
    // 1 — Idempotency check
    const tenantId = getPlatformTenantId()
    const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
      contractId,
      EVENT_TYPE,
      req.body as unknown as Record<string, unknown>,
      tenantId
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId, tenantId);
      return duplicate(res, eventId);
    }

    // 2 — Update trustless_work_escrows
    const validStates: string[] = getValidPriorStates(
      EscrowStatus.Disputed,
      EscrowEventType.DisputeOpened
    );

    const updated = await disputeEscrow(contractId, validStates, tenantId);

    if (!updated) {
      return notFound(res, {
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    const escrowId = updated.id;

    // 3 — Mirror status to safetrust.reservations
    await mirrorReservationStatus(escrowId, 'disputed', tenantId);

    await markWebhookEventProcessed(eventId, tenantId);

    logger.info('escrow.dispute.succeeded', { contractId, disputer });
    return ok(res);

  } catch (error) {
    logger.error('escrow.dispute.failed', { contractId: req.body?.contractId, error });
    return serverError(res, 'Failed to update escrow status');
  }
};
