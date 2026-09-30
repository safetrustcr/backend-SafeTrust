import { Request, Response } from 'express';
import { ApproveMilestonePayload } from '@safetrust/types';
import {
  validateApproveMilestonePayload,
  approveMilestone,
  MilestoneValidationError,
  EscrowNotFoundError,
  MilestoneNotFoundError,
} from '../../services/milestone.service';

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
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    const error = err as Error;
    return res.status(400).json({ success: false, error: error.message });
  }

  try {
    // 2 — Process idempotency, milestone approval, and reservation update
    const { isDuplicate, eventId } = await approveMilestone(
      contractId,
      milestoneId,
      approver,
      req.body as unknown as Record<string, unknown>
    );

    if (isDuplicate) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        eventId,
      });
    }

    console.log(
      `[escrow/approve-milestone] ✅ Milestone approved — contractId: ${contractId}, milestoneId: ${milestoneId}`
    );
    return res.status(200).json({ success: true });

  } catch (err) {
    if (err instanceof EscrowNotFoundError || err instanceof MilestoneNotFoundError) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    const error = err as Error & { details?: unknown };
    console.error('[escrow/approve-milestone] ❌ failed:', error.details || error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to update milestone approval',
    });
  }
}
