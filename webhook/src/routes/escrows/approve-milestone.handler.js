'use strict';

const DEFAULT_HASURA_ENDPOINT = 'http://graphql-engine:8080/v1/graphql';

const APPROVE_MILESTONE_MUTATION = `
  update_escrow_milestones(
    where: {
      escrow: { contract_id: { _eq: $contractId } }
      milestone_id: { _eq: $milestoneId }
    }
    _set: {
      status: "approved"
      approved_by: $approver
      approved_at: $approvedAt
      updated_at: $approvedAt
    }
  ) {
    affected_rows
    returning {
      id
      milestone_id
      status
      approved_by
    }
  }
`;

const UPDATE_ESCROW_STATUS_MUTATION = `
  update_trustless_work_escrows(
    where: {
      contract_id: { _eq: $contractId }
      milestones: {
        milestone_id: { _eq: $milestoneId }
        status: { _eq: "approved" }
        approved_by: { _eq: $approver }
        approved_at: { _eq: $approvedAt }
      }
    }
    _set: {
      status: "milestone_approved"
      updated_at: $approvedAt
    }
  ) {
    affected_rows
    returning {
      id
      contract_id
      status
    }
  }
`;

const APPROVE_MILESTONE_TRANSACTION_MUTATION = `
  mutation ApproveMilestone(
    $contractId: String!
    $milestoneId: String!
    $approver: String!
    $approvedAt: timestamptz!
  ) {
    ${APPROVE_MILESTONE_MUTATION}
    ${UPDATE_ESCROW_STATUS_MUTATION}
  }
`;

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
    const data = await postHasura(APPROVE_MILESTONE_TRANSACTION_MUTATION, {
      contractId,
      milestoneId,
      approver,
      approvedAt,
    });

    const milestoneRows = data.update_escrow_milestones?.affected_rows || 0;
    const escrowRows = data.update_trustless_work_escrows?.affected_rows || 0;

    if (milestoneRows === 0 || escrowRows === 0) {
      console.warn(
        `[escrow/approve-milestone] no matching records for contractId=${contractId} milestoneId=${milestoneId}`
      );
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
  APPROVE_MILESTONE_MUTATION,
  APPROVE_MILESTONE_TRANSACTION_MUTATION,
  UPDATE_ESCROW_STATUS_MUTATION,
  getHasuraEndpoint,
  postHasura,
};
