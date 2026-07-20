'use strict';

const DEFAULT_HASURA_ENDPOINT = 'http://graphql-engine:8080/v1/graphql';

function getHasuraEndpoint() {
  const configured = process.env.HASURA_GRAPHQL_ENDPOINT || DEFAULT_HASURA_ENDPOINT;
  return configured.endsWith('/v1/graphql') ? configured : `${configured.replace(/\/$/, '')}/v1/graphql`;
}

async function postHasura(query, variables) {
  const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET;

  if (!adminSecret) {
    throw new Error('Missing HASURA_GRAPHQL_ADMIN_SECRET');
  }

  const response = await fetch(getHasuraEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': adminSecret,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Hasura request failed with status ${response.status}`);
  }

  if (data.errors) {
    const error = new Error('Hasura mutation failed');
    error.details = data.errors;
    throw error;
  }

  return data.data;
}

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
    // Step 1: Look up the escrow ID using camelCase fields
    let escrowId;

    const lookupQuery = `
      query GetEscrowId($contractId: String!) {
        trustless_work_escrows(where: { contractId: { _eq: $contractId } }) {
          id
        }
      }
    `;
    const data = await postHasura(lookupQuery, { contractId });
    if (data.trustless_work_escrows && data.trustless_work_escrows.length > 0) {
      escrowId = data.trustless_work_escrows[0].id;
    }

    if (!escrowId) {
      return res.status(404).json({
        error: 'Escrow or milestone not found',
      });
    }

    // Step 2: Perform the updates using the found escrowId UUID
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
    const resultMilestone = await postHasura(mutationMilestone, {
      escrowId,
      milestoneId,
      approver,
      approvedAt
    });
    const milestoneRows = resultMilestone.update_escrow_milestones?.affected_rows || 0;

    if (milestoneRows === 0) {
      return res.status(404).json({
        error: 'Escrow or milestone not found',
      });
    }

    const mutationEscrow = `
      mutation ApproveEscrow(
        $escrowId: uuid!
        $approvedAt: timestamptz!
      ) {
        update_trustless_work_escrows(
          where: {
            id: { _eq: $escrowId }
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
    const resultEscrow = await postHasura(mutationEscrow, {
      escrowId,
      approvedAt
    });
    const escrowRows = resultEscrow.update_trustless_work_escrows?.affected_rows || 0;

    if (escrowRows === 0) {
      return res.status(404).json({
        error: 'Escrow or milestone not found',
      });
    }

    console.log(
      `[escrow/approve-milestone] milestone approved — contractId=${contractId} milestoneId=${milestoneId}`
    );
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[escrow/approve-milestone] failed:', error.details || error.message);
    return res.status(500).json({
      error: 'Failed to update milestone approval',
    });
  }
}

module.exports = {
  approveMilestoneHandler,
  getHasuraEndpoint,
  postHasura,
};
