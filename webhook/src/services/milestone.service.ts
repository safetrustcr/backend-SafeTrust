import { hasuraRequest } from './hasura';

// ── Types ──────────────────────────────────────────────────────────────────────

/** Result of resolving a contractId to its internal Hasura UUID. */
export interface EscrowLookupResult {
  escrowId: string;
}

// ── Errors ─────────────────────────────────────────────────────────────────────

export class MilestoneValidationError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'MilestoneValidationError';
    this.statusCode = statusCode;
  }
}

export class EscrowNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = 'EscrowNotFoundError';
  }
}

export class MilestoneNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = 'MilestoneNotFoundError';
  }
}

// ── Service functions ──────────────────────────────────────────────────────────

/**
 * Validate the fields required to approve a milestone.
 * Throws MilestoneValidationError (400) on failure.
 */
export function validateApproveMilestonePayload(
  contractId: unknown,
  milestoneId: unknown,
  approver: unknown,
  flag: unknown
): void {
  if (!contractId || !milestoneId || !approver || flag === undefined) {
    throw new MilestoneValidationError(
      'Missing required fields: contractId, milestoneId, approver, flag'
    );
  }

  if (flag !== true) {
    throw new MilestoneValidationError('flag must be true to approve a milestone');
  }
}

/**
 * Look up an escrow UUID by its on-chain contractId.
 * Throws EscrowNotFoundError (404) if no record is found.
 */
export async function lookupEscrowByContractId(
  contractId: string
): Promise<EscrowLookupResult> {
  const query = `
    query GetEscrowId($contractId: String!) {
      trustless_work_escrows(where: { contractId: { _eq: $contractId } }) {
        id
      }
    }
  `;

  const data = await hasuraRequest<{
    trustless_work_escrows?: Array<{ id: string }>;
  }>(query, { contractId });

  const escrowId = data.trustless_work_escrows?.[0]?.id;
  if (!escrowId) {
    throw new EscrowNotFoundError('Escrow not found');
  }

  return { escrowId };
}

/**
 * Approve a milestone on the given escrow, then update the escrow status and
 * mirror the result to the reservations table — all in three sequential Hasura
 * mutations.
 *
 * Throws MilestoneNotFoundError (404) if the milestone row does not exist.
 * Throws EscrowNotFoundError (404) if the escrow is not in a valid prior state.
 */
export async function approveMilestoneAndUpdateReservation(
  escrowId: string,
  milestoneId: string,
  approver: string
): Promise<void> {
  const approvedAt = new Date().toISOString();

  // 1 — Update escrow_milestones
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
  }>(mutationMilestone, { escrowId, milestoneId, approver, approvedAt });

  if (!milestoneResult.update_escrow_milestones?.affected_rows) {
    throw new MilestoneNotFoundError('Milestone not found');
  }

  // 2 — Update trustless_work_escrows using the Rust state machine to get
  //     the authoritative set of valid prior states.
  //     The addon is lazy-loaded so module import works in test environments
  //     where the Rust binary has not been compiled.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getValidPriorStates } = require('../../../crates/escrow-state-machine') as {
    getValidPriorStates: (to: string, event: string) => string;
  };
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
  }>(mutationEscrow, { escrowId, approvedAt, validStates });

  if (!escrowResult.update_trustless_work_escrows?.affected_rows) {
    throw new EscrowNotFoundError('Escrow not found');
  }

  // 3 — Mirror the milestone result to public.reservations
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
}
