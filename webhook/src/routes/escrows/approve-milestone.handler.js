'use strict';

const {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} = require('../../services/hasura');

const EVENT_TYPE = 'milestone.approved';

async function approveMilestoneHandler(req, res) {
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
      req.body
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

    const lookupData = await hasuraRequest(lookupQuery, { contractId });
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

    const milestoneResult = await hasuraRequest(mutationMilestone, {
      escrowId,
      milestoneId,
      approver,
      approvedAt,
    });

    if (!milestoneResult.update_escrow_milestones?.affected_rows) {
      return res.status(404).json({ error: 'Milestone not found' });
    }

    // 3 — Update trustless_work_escrows
    const mutationEscrow = `
      mutation ApproveEscrow($escrowId: uuid!, $approvedAt: timestamptz!) {
        update_trustless_work_escrows(
          where: { id: { _eq: $escrowId } }
          _set: {
            status: "milestone_approved"
            updatedAt: $approvedAt
          }
        ) {
          affected_rows
        }
      }
    `;

    const escrowResult = await hasuraRequest(mutationEscrow, {
      escrowId,
      approvedAt,
    });

    if (!escrowResult.update_trustless_work_escrows?.affected_rows) {
      return res.status(404).json({ error: 'Escrow not found' });
    }

    // 4 — Mirror status to public.reservations
    const reservationStatus = milestoneId === 'check_in' ? 'checked_in' : 'checked_out';

    const mirrorMutation = `
      mutation MirrorMilestoneToReservation($contractId: String!, $status: String!) {
        update_reservations(
          where: { escrow: { contractId: { _eq: $contractId } } }
          _set: {
            status: $status
            updated_at: "now()"
          }
        ) {
          returning { id status }
        }
      }
    `;

    await hasuraRequest(mirrorMutation, { contractId, status: reservationStatus });

    await markWebhookEventProcessed(eventId);

    console.log(
      `[escrow/approve-milestone] ✅ Milestone approved — contractId: ${contractId}, milestoneId: ${milestoneId}`
    );
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[escrow/approve-milestone] ❌ failed:', error.details || error.message);
    return res.status(500).json({ error: 'Failed to update milestone approval' });
  }
}

module.exports = { approveMilestoneHandler };