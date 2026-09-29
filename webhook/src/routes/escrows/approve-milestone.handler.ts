import { Request, Response } from 'express';
import { ApproveMilestonePayload } from '@safetrust/types';
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../services/hasura';
import {
  validateApproveMilestonePayload,
  lookupEscrowByContractId,
  approveMilestoneAndUpdateReservation,
  MilestoneValidationError,
  EscrowNotFoundError,
  MilestoneNotFoundError,
} from '../../services/milestone.service';

const EVENT_TYPE = 'milestone.approved';

export async function approveMilestoneHandler(
  req: Request<{}, {}, ApproveMilestonePayload>,
  res: Response
): Promise<Response> {
  const { contractId, milestoneId, approver, flag } = req.body || {};

  // 1 — Validate payload fields
  try {
    validateApproveMilestonePayload(contractId, milestoneId, approver, flag);
  } catch (err) {
    if (err instanceof MilestoneValidationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    const error = err as Error;
    return res.status(400).json({ error: error.message });
  }

  try {
    // 2 — Idempotency check
    const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
      contractId,
      `${EVENT_TYPE}:${milestoneId}`,
      req.body as unknown as Record<string, unknown>
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId);
      return res.status(200).json({ received: true });
    }

    // 3 — Look up escrow UUID by contractId
    const { escrowId } = await lookupEscrowByContractId(contractId);

    // 4 — Apply milestone approval and mirror to reservations
    await approveMilestoneAndUpdateReservation(escrowId, milestoneId, approver);

    await markWebhookEventProcessed(eventId);

    console.log(
      `[escrow/approve-milestone] ✅ Milestone approved — contractId: ${contractId}, milestoneId: ${milestoneId}`
    );
    return res.status(200).json({ received: true });

  } catch (err) {
    if (err instanceof EscrowNotFoundError || err instanceof MilestoneNotFoundError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    const error = err as Error & { details?: unknown };
    console.error('[escrow/approve-milestone] ❌ failed:', error.details || error.message);
    return res.status(500).json({ error: 'Failed to update milestone approval' });
  }
}
