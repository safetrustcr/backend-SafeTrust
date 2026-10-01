import { hasuraRequest, logAndCheckWebhookEvent, markWebhookEventProcessed } from './hasura';
import { connect } from './db';

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

export class EscrowStateConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'EscrowStateConflictError';
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
 * Approve a milestone, update the escrow status, and mirror the result to
 * the reservations table in a single PostgreSQL transaction.
 *
 * Throws MilestoneNotFoundError (404) if the milestone row does not exist.
 * Throws EscrowNotFoundError (404) if the escrow does not exist.
 * Throws EscrowStateConflictError (409) if the escrow exists but is not in
 * a valid prior state.
 */
export async function approveMilestoneAndUpdateReservation(
  escrowId: string,
  milestoneId: string,
  approver: string
): Promise<void> {
  const approvedAt = new Date().toISOString();

  // Resolve valid prior states before any DB write.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getValidPriorStates } = require('../../../crates/escrow-state-machine') as {
    getValidPriorStates: (to: string, event: string) => string;
  };
  const validStates: string[] = JSON.parse(
    getValidPriorStates('milestone_approved', 'milestone.approved') as string
  );

  const reservationStatus =
    milestoneId === 'check_in' ? 'checked_in' : 'checked_out';

  const client = await connect();

  try {
    await client.query('BEGIN');

    const milestoneResult = await client.query(
      `
        SELECT id
        FROM safetrust.escrow_milestones
        WHERE escrow_id = $1
          AND milestone_id = $2
        FOR UPDATE
      `,
      [escrowId, milestoneId]
    );

    if (milestoneResult.rowCount === 0) {
      throw new MilestoneNotFoundError('Milestone not found');
    }

    const escrowResult = await client.query(
      `
        SELECT id, status
        FROM safetrust.trustless_work_escrows
        WHERE id = $1
        FOR UPDATE
      `,
      [escrowId]
    );

    if (escrowResult.rowCount === 0) {
      throw new EscrowNotFoundError('Escrow not found');
    }

    const escrowStatus = escrowResult.rows[0].status as string;

    if (!validStates.includes(escrowStatus)) {
      throw new EscrowStateConflictError(
        'Escrow is not in a valid state for milestone approval'
      );
    }

    await client.query(
      `
        UPDATE safetrust.escrow_milestones
        SET
          status = 'approved',
          approved_by = $1,
          approved_at = $2,
          updated_at = $2
        WHERE escrow_id = $3
          AND milestone_id = $4
      `,
      [approver, approvedAt, escrowId, milestoneId]
    );

    await client.query(
      `
        UPDATE safetrust.trustless_work_escrows
        SET
          status = 'milestone_approved',
          updated_at = $1
        WHERE id = $2
      `,
      [approvedAt, escrowId]
    );

    await client.query(
      `
        UPDATE safetrust.reservations
        SET
          status = $1,
          updated_at = $2
        WHERE escrow_id = $3
      `,
      [reservationStatus, approvedAt, escrowId]
    );

    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(
        '[milestone.service] Failed to rollback milestone approval transaction:',
        rollbackError
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

/**
 * Processes a milestone approval webhook with idempotency protection.
 */
export async function approveMilestone(
  contractId: string,
  milestoneId: string,
  approver: string,
  rawPayload: Record<string, unknown>
): Promise<{ isDuplicate: boolean; eventId: string }> {
  const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
    contractId,
    `milestone.approved:${milestoneId}`,
    rawPayload
  );

  if (isDuplicate) {
    await markWebhookEventProcessed(eventId);
    return { isDuplicate: true, eventId };
  }

  const service = require('./milestone.service') as typeof import('./milestone.service');
  const { escrowId } = await service.lookupEscrowByContractId(contractId);
  await service.approveMilestoneAndUpdateReservation(escrowId, milestoneId, approver);

  await markWebhookEventProcessed(eventId);

  return { isDuplicate: false, eventId };
}
