import { Request, Response } from 'express';
import { badRequest, conflict, duplicate, notFound, ok, serverError } from '../../utils/response';
import { ApproveMilestonePayload } from '@safetrust/types';
import { logger } from '../../middleware/logger';
import {
  approveMilestone,
  EscrowStateConflictError,
  EscrowNotFoundError,
  MilestoneNotFoundError,
} from '../../services/milestone.service';
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

  try {
    const result = await approveMilestone(

      contractId,
      milestoneId,
      approver,
      req.body as unknown as Record<string, unknown>
    );

    if (result.isDuplicate) {
      return duplicate(res, result.eventId);
    }

    logger.info('escrow.approve_milestone.succeeded', { contractId, milestoneId });
    return ok(res);

  } catch (error) {
    const err = error as Error;

    if (err instanceof EscrowStateConflictError) {
      return conflict(res, { error: err.message });
    }

    if (
      err instanceof EscrowNotFoundError ||
      err instanceof MilestoneNotFoundError
    ) {
      return notFound(res, { error: err.message });
    }

    logger.error('escrow.approve_milestone.failed', { contractId: req.body?.contractId, error });
    return serverError(res, { error: 'Failed to update milestone approval' });
  }
}
