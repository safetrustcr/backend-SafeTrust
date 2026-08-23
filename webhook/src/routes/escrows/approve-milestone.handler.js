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

    const { getValidPriorStates } = require('../../../../crates/escrow-state-machine');
    const validStatesJson = getValidPriorStates('milestone_approved', 'milestone.approved');
    const validStates = JSON.parse(validStatesJson);

    // 2 & 3 - Update escrow_milestones and trustless_work_escrows atomically
    const combinedMutation = `
      mutation ApproveMilestoneAndEscrow(
        $escrowId: uuid!
        $milestoneId: String!
        $approver: String!
        $approvedAt: timestamptz!
        $validStates: [String!]!
      ) {
        update_escrow_milestones(
          where: {
            escrowId: { _eq: $escrowId }
            milestoneId: { _eq: $milestoneId }
            escrow: { status: { _in: $validStates } }
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
        update_trustless_work_escrows(
          where: { 
            id: { _eq: $escrowId },
            status: { _in: $validStates },
            milestones: { milestoneId: { _eq: $milestoneId } }
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

    const result = await hasuraRequest(combinedMutation, {
      escrowId,
      milestoneId,
      approver,
      approvedAt,
      validStates,
    });

    const milestoneRows = result.update_escrow_milestones?.affected_rows || 0;
    const escrowRows = result.update_trustless_work_escrows?.affected_rows || 0;

    if (milestoneRows === 0 || escrowRows === 0) {
      return res.status(404).json({ error: 'Milestone/Escrow not found or invalid state transition' });
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