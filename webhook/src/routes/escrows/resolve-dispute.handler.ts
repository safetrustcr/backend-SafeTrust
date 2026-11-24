import { Request, Response } from 'express';
import { badRequest, duplicate, notFound, ok, serverError } from '../../utils/response'
import { ResolveDisputePayload, EscrowEventType, EscrowStatus } from '../../domain';
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../repositories/webhook-event.repository';
import {
  resolveDispute,
  appendResolutionNote,
} from '../../repositories/escrow.repository';
import {
  mirrorReservationStatus,
} from '../../repositories/reservation.repository';
import { getPlatformTenantId } from '../../config/tenant';

import { getValidPriorStates } from '../../lib/escrow-transitions';
import { logger } from '../../middleware/logger';

const EVENT_TYPE = EscrowEventType.DisputeResolved;

/**
 * Handles the escrow dispute resolved webhook event.
 * Validates payload, checks idempotency, transitions the escrow to 'resolved',
 * optionally records a resolution note, and mirrors the reservation status.
 *
 * @param req - Express request containing ResolveDisputePayload
 * @param res - Express response object
 * @returns Express response indicating success, duplicate, or error
 */
export const resolveDisputeHandler = async (
  req: Request<{}, {}, ResolveDisputePayload>,
  res: Response
): Promise<Response> => {
  const { contractId, resolver, resolutionNote } = req.body;

  if (!contractId || !resolver) {
    return badRequest(res, {
      error: 'Missing required fields: contractId, resolver'
    });
  }

  try {
    // 1 — Idempotency check
    const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
      contractId,
      EVENT_TYPE,
      req.body as unknown as Record<string, unknown>
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId);
      return duplicate(res, eventId);
    }

    // 2 — Update trustless_work_escrows
    const validStates: string[] = getValidPriorStates(
      EscrowStatus.Resolved,
      EscrowEventType.DisputeResolved
    );

    const updated = await resolveDispute(contractId, validStates);

    if (!updated) {
      return notFound(res, {
        error: `Escrow not found for contractId: ${contractId}`
      });
    }

    const escrowId = updated.id;

    // 3 — Mirror status to safetrust.reservations
    await mirrorReservationStatus(escrowId, 'resolved', getPlatformTenantId());

    // 4 — Store resolution note in escrow_metadata if provided
    if (resolutionNote) {
      await appendResolutionNote(contractId, {
        resolver,
        resolutionNote,
        resolvedAt: new Date().toISOString(),
      });
    }

    await markWebhookEventProcessed(eventId);

    logger.info('escrow.resolve_dispute.succeeded', { contractId, resolver });
    return ok(res);

  } catch (error) {
    logger.error('escrow.resolve_dispute.failed', { contractId: req.body?.contractId, error });
    return serverError(res, 'Failed to update escrow status');
  }
};
