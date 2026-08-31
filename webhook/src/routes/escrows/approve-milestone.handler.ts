import { Request, Response } from 'express';
import { ApproveMilestonePayload } from '@safetrust/types';
import {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../services/hasura';

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
    return res.status(400).json({
      error: 'Missing required fields: contractId, milestoneId, approver, flag',
    });
  }

  if (flag !== true) {
    return res.status(400).json({
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
      return res.status(200).json({ received: true });
    }

    // 1 — Look up escrow UUID by contractId
    const lookupQuery = `
      query GetEscrowId($contractId: String!) {
        trustless_work_escrows(where: { contractId: { _eq: $contractId } }) {
          id
        }
      }
    `;

    const lookupData = await hasuraRequest<{
      trustless_work_escrows?: Array<{ id: string }>;
    }>(lookupQuery, { contractId });
    const escrowId = lookupData.trustless_work_escrows?.[0]?.id;

    if (!escrowId) {
      return res.status(404).json({ error: 'Escrow not found' });
    }

    // 2 — Update escrow_milestones
    const mutationMilestone = `
      mutation ApproveMilestone(
        $escrowId: uuid!
        $milestoneId: String!
        $approver: String!
        $approvedAt: timestamptz!
      ) {
        update_escrow_milestones(
          where: {
            escrowId: { _eq: $escrowId }
            milestoneId: { _eq: $milestoneId }
          }
          _set: {
            status: "approved"
            approvedBy: $approver
            approvedAt: $approvedAt
            updatedAt: $approvedAt
          }
        ) {
          affected_rows
        }
      }
    `;

    const milestoneResult = await hasuraRequest<{
      update_escrow_milestones?: { affected_rows: number };
    }>(mutationMilestone, {
      escrowId,
      milestoneId,
      approver,
      approvedAt,
    });

    if (!milestoneResult.update_escrow_milestones?.affected_rows) {
      return res.status(404).json({ error: 'Milestone not found' });
    }

    // 3 — Update trustless_work_escrows
    // Valid prior states are driven by the Rust state machine, enforcing the
    // legal from-states for milestone approval (active | funded).
    const validStates: string[] = JSON.parse(
      getValidPriorStates('milestone_approved', 'milestone.approved') as string
    );

    const mutationEscrow = `
      mutation ApproveEscrow($escrowId: uuid!, $approvedAt: timestamptz!, $validStates: [String!]!) {
        update_trustless_work_escrows(
          where: {
            id: { _eq: $escrowId }
            status: { _in: $validStates }
          }
          _set: {
            status: "milestone_approved"
            updatedAt: $approvedAt
          }
        ) {
          affected_rows
        }
      }
    `;

    const escrowResult = await hasuraRequest<{
      update_trustless_work_escrows?: { affected_rows: number };
    }>(mutationEscrow, {
      escrowId,
      approvedAt,
      validStates,
    });

    if (!escrowResult.update_trustless_work_escrows?.affected_rows) {
      return res.status(404).json({ error: 'Escrow not found' });
    }

    // 4 — Mirror status to public.reservations
    const reservationStatus = milestoneId === 'check_in' ? 'checked_in' : 'checked_out';

    const mirrorMutation = `
      mutation MirrorMilestoneToReservation($escrowId: uuid!, $status: String!) {
        update_reservations(
          where: { escrowId: { _eq: $escrowId } }
          _set: {
            status: $status
            updatedAt: "now()"
          }
        ) {
          returning { id status }
        }
      }
    `;

    await hasuraRequest(mirrorMutation, { escrowId, status: reservationStatus });

    await markWebhookEventProcessed(eventId);

    console.log(
      `[escrow/approve-milestone] ✅ Milestone approved — contractId: ${contractId}, milestoneId: ${milestoneId}`
    );
    return res.status(200).json({ received: true });

  } catch (error) {
    const err = error as Error & { details?: unknown };
    console.error('[escrow/approve-milestone] ❌ failed:', err.details || err.message);
    return res.status(500).json({ error: 'Failed to update milestone approval' });
  }
}
