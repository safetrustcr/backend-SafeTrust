import { Request, Response } from 'express';
import { badRequest, duplicate, notFound, ok, serverError } from '../../utils/response'
import { ApproveMilestonePayload } from '@safetrust/types';
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../repositories/webhook-event.repository';
import {
  getEscrowByContractId,
  approveMilestone,
  approveEscrowStatus,
} from '../../repositories/escrow.repository';
import {
  mirrorReservationStatus,
} from '../../repositories/reservation.repository';

// Compile-time SafeTrust escrow state machine (Neon native addon).
// Replaces hardcoded status strings with the authoritative transition table.
const { getValidPriorStates } = require('../../../../crates/escrow-state-machine') as {
  getValidPriorStates: (to: string, event: string) => string
}

const EVENT_TYPE = 'milestone.approved';

export async function approveMilestoneHandler(
  req: Request<{}, {}, ApproveMilestonePayload>,
  res: Response
): Promise<Response> {
  const { contractId, milestoneId, approver, flag } = req.body || {};

  if (!contractId || !milestoneId || !approver || flag === undefined) {
    return badRequest(res, {
      error: 'Missing required fields: contractId, milestoneId, approver, flag',
    });
  }

  if (flag !== true) {
    return badRequest(res, {
      error: 'flag must be true to approve a milestone',
    });
  }

  const approvedAt = new Date().toISOString();

  try {
    const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
      contractId,
      `${EVENT_TYPE}:${milestoneId}`,
      req.body as unknown as Record<string, unknown>
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId);
      return duplicate(res, eventId);
    }

    // 1 — Look up escrow UUID by contractId
    const escrow = await getEscrowByContractId(contractId);
    const escrowId = escrow?.id;

    if (!escrowId) {
      return notFound(res, { error: 'Escrow not found' });
    }

    // 2 — Update escrow_milestones
    const milestoneUpdated = await approveMilestone(
      escrowId,
      milestoneId,
      approver,
      approvedAt
    );

    if (!milestoneUpdated) {
      return notFound(res, { error: 'Milestone not found' });
    }

    // 3 — Update trustless_work_escrows
    const validStates: string[] = JSON.parse(
      getValidPriorStates('milestone_approved', 'milestone.approved') as string
    );

    const escrowUpdated = await approveEscrowStatus(
      escrowId,
      approvedAt,
      validStates
    );

    if (!escrowUpdated) {
      return notFound(res, { error: 'Escrow not found' });
    }

    // 4 — Mirror status to public.reservations
    const reservationStatus = milestoneId === 'check_in' ? 'checked_in' : 'checked_out';
    await mirrorReservationStatus(escrowId, reservationStatus);

    await markWebhookEventProcessed(eventId);

    console.log(
      `[escrow/approve-milestone] ✅ Milestone approved — contractId: ${contractId}, milestoneId: ${milestoneId}`
    );
    return ok(res);

  } catch (error) {
    const err = error as Error & { details?: unknown };
    console.error('[escrow/approve-milestone] ❌ failed:', err.details || err.message);
    return serverError(res, { error: 'Failed to update milestone approval' });
  }
}
