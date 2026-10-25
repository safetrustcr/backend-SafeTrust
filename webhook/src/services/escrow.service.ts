import { PoolClient } from 'pg';
import { withTransaction } from './db';
import { mirrorReservationStatus } from '../repositories/reservation.repository';
import { EscrowEventType, EscrowStatus } from '../types/escrow.types';
import { InitializeEscrowPayload } from '@safetrust/types';
import { hasuraTenantRequest, TenantMismatchError } from './tenant-scoped-hasura';
import {
  findReservationTenantId,
  linkEscrowToReservation,
} from '../repositories/reservation.repository';
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../repositories/webhook-event.repository';
import { amountToStroops } from '../lib/stellar-amounts';
import { verifyProofOfFunds } from '../lib/zk-verifier';

export { TenantMismatchError };

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * The validated, normalized form of an escrow initialization payload.
 * Produced by validateEscrowInitializationPayload.
 */
export interface EscrowInitPayload {
  contract_id: string;
  marker: string;
  approver: string;
  releaser: string;
  resolver: string | null;
  amount: number | string;
  escrow_type: string;
  asset_code: string;
  asset_issuer: string | null;
  booking_id: string | null;
  room_id: string | null;
  hotel_id: string | null;
  guest_id: string | null;
  booking_metadata: { reservation_id?: string; [key: string]: unknown } | null;
  raw: InitializeEscrowPayload;
}

/**
 * The persisted escrow record returned by Hasura after insertion.
 */
export interface TrustlessWorkEscrow {
  id: string;
  contractId: string;
  status: string;
  createdAt: string;
  tenantId?: string;
}

// ── Validation error ───────────────────────────────────────────────────────────

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


export class EscrowValidationError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'EscrowValidationError';
    this.statusCode = statusCode;
  }
}

/** Thrown when the ZK verifier native addon is unavailable. */
export class ZkVerifierUnavailableError extends Error {
  readonly statusCode = 503;
  constructor(message: string) {
    super(message);
    this.name = 'ZkVerifierUnavailableError';
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Normalize an untrusted decimal string to its canonical u64 representation. */
function normalizeU64(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) return null;
  if (value.length > 20) return null;
  const U64_MAX = 18_446_744_073_709_551_615n;
  const parsed = BigInt(value);
  if (parsed > U64_MAX) return null;
  return parsed.toString();
}

// ── Service functions ──────────────────────────────────────────────────────────

/**
 * Validate and normalize an escrow initialization payload.
 *
 * Checks required fields, escrow_type whitelist, and optional ZK proof bundle.
 * Throws EscrowValidationError (400) or ZkVerifierUnavailableError (503) on failure.
 */
export function validateEscrowInitializationPayload(
  body: unknown
): EscrowInitPayload {
  const {
    contract_id,
    marker,
    approver,
    releaser,
    resolver = null,
    amount,
    escrow_type,
    asset_code,
    asset_issuer = null,
    booking_id = null,
    room_id = null,
    hotel_id = null,
    guest_id = null,
    booking_metadata = null,
    zk_proof,
    zk_verification_key,
    zk_threshold_stroops,
    zk_balance_commitment,
  } = (body as InitializeEscrowPayload) ?? {};
  
  // 1 — Required fields
  if (
    !contract_id ||
    !marker ||
    !approver ||
    !releaser ||
    amount === undefined ||
    amount === null ||
    !escrow_type
  ) {
    throw new EscrowValidationError(
      'Missing required fields: contract_id, marker, approver, releaser, amount, escrow_type'
    );
  }

  // 2 — Runtime type validation
  if (amountToStroops(amount) === null || typeof escrow_type !== 'string') {
    throw new EscrowValidationError(
      'amount must be a number and escrow_type must be a string'
    );
  }

  // 3 — Escrow type whitelist (matches DB CHECK constraint)
  const validTypes = ['single_release', 'multi_release'];
  if (!validTypes.includes(escrow_type)) {
    throw new EscrowValidationError(
      `escrow_type must be one of: ${validTypes.join(', ')}`
    );
  }
  
  // 3 — Optional ZK proof bundle: must be all-or-nothing; validates threshold.
  // Real-funds ZK enforcement remains disabled by default until the chosen
  // eligibility architecture (ADR-0001) is fully implemented (blocks ZK-02 through ZK-09).
  const isZkEnforced = process.env.ZK_ENFORCEMENT_ENABLED === 'true';
  const zkValues = [zk_proof, zk_verification_key, zk_threshold_stroops, zk_balance_commitment];
  const hasZkBundle = zkValues.some((v) => v !== undefined && v !== null);

  if (isZkEnforced && !hasZkBundle) {
    throw new EscrowValidationError(
      'ZK proof of funds bundle is required for escrow initialization',
      400
    );
  }

  if (hasZkBundle && process.env.ZK_ENABLED !== 'true') {
    throw new EscrowValidationError(
      'Unsupported Feature: ZK proof verification is disabled'
    );
  }

  if (hasZkBundle) {
    const hasCompleteBundle =
      typeof zk_proof === 'string' && zk_proof.length > 0 &&
      typeof zk_verification_key === 'string' && zk_verification_key.length > 0 &&
      typeof zk_threshold_stroops === 'string' && zk_threshold_stroops.length > 0 &&
      typeof zk_balance_commitment === 'string' && zk_balance_commitment.length > 0;

    if (!hasCompleteBundle) {
      throw new EscrowValidationError(
        'zk_proof, zk_verification_key, zk_threshold_stroops, and zk_balance_commitment must be supplied together'
      );
    }

    const expectedThreshold = amountToStroops(amount);
    const suppliedThreshold = normalizeU64(zk_threshold_stroops);
    if (!expectedThreshold || !suppliedThreshold || suppliedThreshold !== expectedThreshold) {
      throw new EscrowValidationError('Invalid ZK proof of funds');
    }

    try {
      const isValidProof = verifyProofOfFunds(
        zk_proof,
        zk_verification_key,
        suppliedThreshold,
        zk_balance_commitment
      );
      if (!isValidProof) {
        throw new EscrowValidationError('Invalid ZK proof of funds');
      }
    } catch (err) {
      if (err instanceof EscrowValidationError) throw err;
      const error = err as Error & { code?: string };
      console.error('[escrow.service] ZK verifier error:', error.message);
      if (error.code === 'ZK_VERIFIER_MISCONFIGURED') {
        throw new EscrowValidationError('ZK proof verifier is misconfigured', 500);
      }
      throw new ZkVerifierUnavailableError('ZK proof verification is unavailable');
    }
  }

  return {
    contract_id,
    marker,
    approver,
    releaser,
    resolver: resolver ?? null,
    amount,
    escrow_type,
    asset_code: asset_code ?? 'USDC',
    asset_issuer: asset_issuer ?? null,
    booking_id: booking_id ?? null,
    room_id: room_id ?? null,
    hotel_id: hotel_id ?? null,
    guest_id: guest_id ?? null,
    booking_metadata: booking_metadata ?? null,
    raw: body as InitializeEscrowPayload,
  };
}

/**
 * Insert a new escrow record into trustless_work_escrows via Hasura.
 * Returns the created escrow record.
 */
export async function persistEscrow(
  payload: EscrowInitPayload,
  tenantId: string
): Promise<TrustlessWorkEscrow> {
  const mutation = `
    mutation InitializeEscrow($object: trustless_work_escrows_insert_input!) {
      insert_trustless_work_escrows_one(
        object: $object
        on_conflict: {
          constraint: trustless_work_escrows_contract_id_key
          update_columns: [contractId]
        }
      ) {
        id
        contractId
        status
        createdAt
        tenantId
      }
    }
  `;

  const data = await hasuraTenantRequest<{
    insert_trustless_work_escrows_one?: TrustlessWorkEscrow;
  }>(tenantId, mutation, {
    object: {
      contractId: payload.contract_id,
      marker: payload.marker,
      approver: payload.approver,
      releaser: payload.releaser,
      resolver: payload.resolver,
      escrowType: payload.escrow_type,
      status: 'created',
      assetCode: payload.asset_code,
      assetIssuer: payload.asset_issuer,
      amount: payload.amount,
      balance: 0,
      bookingId: payload.booking_id,
      roomId: payload.room_id,
      hotelId: payload.hotel_id,
      guestId: payload.guest_id,
      tenantId,
      escrowMetadata: payload.raw,
      bookingMetadata: payload.booking_metadata,
    },
  });

  const escrow = data.insert_trustless_work_escrows_one;
  if (!escrow) {
    throw new Error('Failed to insert escrow record');
  }

  return escrow;
}

/** Thrown when the reservation named in booking_metadata does not exist. */
export class ReservationNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(reservationId: string) {
    super(`Reservation ${reservationId} not found`);
    this.name = 'ReservationNotFoundError';
  }
}

/**
 * Resolve the tenant that owns `reservationId` before any escrow write.
 *
 * Throws `ReservationNotFoundError` when the reservation does not exist and
 * `TenantMismatchError` when it belongs to a tenant other than
 * `expectedTenantId` (the caller's verified tenant; the platform tenant for
 * signed callbacks and x402 payments).
 * Returns the reservation's own tenant, which callers use for both the escrow
 * insert and the reservation link.
 */
export async function resolveReservationTenant(
  reservationId: string,
  expectedTenantId: string
): Promise<string> {
  const reservationTenantId = await findReservationTenantId(reservationId);
  if (!reservationTenantId) {
    throw new ReservationNotFoundError(reservationId);
  }
  if (reservationTenantId !== expectedTenantId) {
    throw new TenantMismatchError(
      `Reservation ${reservationId} does not belong to tenant ${expectedTenantId}`
    );
  }
  return reservationTenantId;
}

/**
 * Link a reservation row in `tenantId` to the created escrow.
 * Throws when no reservation in that tenant matches.
 */
export async function linkReservationToEscrow(
  reservationId: string,
  escrowId: string,
  tenantId: string
): Promise<void> {
  await linkEscrowToReservation(reservationId, escrowId, tenantId);

  console.log(
    `[escrow.service] Reservation linked — reservationId: ${reservationId}, escrowId: ${escrowId}`
  );
}


/**
 * Processes an escrow initialization webhook with idempotency protection.
 */
export async function initializeEscrow(
  payload: EscrowInitPayload,
  rawPayload: Record<string, unknown>,
  tenantId: string
): Promise<{ isDuplicate: boolean; eventId: string; escrow?: TrustlessWorkEscrow }> {
  const { isDuplicate, eventId, processed } = await logAndCheckWebhookEvent(
    payload.contract_id,
    'escrow.initialized',
    rawPayload
  );

  // Retry a duplicate whose earlier delivery failed part-way; persistEscrow
  // upserts on contract_id, so re-running it is safe.
  if (isDuplicate && processed !== false) {
    await markWebhookEventProcessed(eventId);
    return { isDuplicate: true, eventId };
  }

  const reservationId = payload.booking_metadata?.reservation_id;
  const escrowTenantId = reservationId
    ? await resolveReservationTenant(reservationId, tenantId)
    : tenantId;

  const escrow = await persistEscrow(payload, escrowTenantId);

  // The upsert on contract_id returns an existing row unchanged, so a row
  // owned by another tenant must be rejected before it is linked.
  if (escrow.tenantId !== escrowTenantId) {
    throw new TenantMismatchError(
      `Escrow ${payload.contract_id} does not belong to tenant ${escrowTenantId}`
    );
  }

  if (reservationId) {
    await linkReservationToEscrow(reservationId, escrow.id, escrowTenantId);
  }

  await markWebhookEventProcessed(eventId);

  return { isDuplicate: false, eventId, escrow };
}


// ── Shared Transaction & Lifecycle Management ──────────────────────────────────
//
// REFERENCE IMPLEMENTATION:
// Modeled on milestone.service.ts:148-205 (approveMilestoneAndUpdateReservation).
//
// TRANSACTION ARCHITECTURE & APPROACH FOR SPANNING WRITES:
// When an escrow lifecycle event occurs (such as escrow.funded or funds.released),
// three database operations must succeed or fail as a single atomic unit:
//   1. Webhook event claim & deduplication check (safetrust.trustless_work_webhook_events)
//   2. Escrow state transition with prior-state guard (safetrust.trustless_work_escrows)
//   3. Reservation status mirror (safetrust.reservations)
//
// CHOSEN APPROACH: Direct PostgreSQL SQL Transactions
// Hasura GraphQL operates over HTTP and executes each mutation in its own independent
// transaction. An application-level PostgreSQL transaction (BEGIN...COMMIT) via PoolClient
// cannot span across an external Hasura HTTP write. If Hasura is used to update the escrow
// state and subsequently a SQL/Hasura write to reservations fails, the escrow update cannot
// be rolled back, leading to permanent data divergence.
// Therefore, we moved all escrow lifecycle writes to direct PostgreSQL queries executed
// on a single client connection wrapped in BEGIN ... COMMIT. If any step fails (e.g. reservation
// mirror failure), ROLLBACK reverts the escrow state update, the reservation change, and the
// event claim, leaving the webhook event uncommitted and claimable for safe retry.
//
// WHY NOTIFICATIONS ARE OUTSIDE THE TRANSACTION:
// Notifications (chat conversations, emails, webhook callbacks) involve external I/O
// services that cannot participate in a PostgreSQL two-phase commit and cannot be rolled
// back once sent. Sending them inside an uncommitted transaction risks:
//   - Sending spurious notifications if the transaction subsequently rolls back.
//   - Holding database connection locks while waiting on external network calls.
//   - Aborting a valid state change if a notification provider encounters a temporary glitch.
// Thus, notifications are dispatched strictly AFTER commit, and any failure is caught and
// logged as non-fatal.

export interface EscrowLifecycleParams {
  contractId: string;
  eventType: string;
  targetStatus: EscrowStatus | string;
  reservationStatus: string;
  rawPayload: Record<string, unknown>;
  amount?: number;
  validPriorStates?: string[];
  tenantId?: string;
}

export interface EscrowLifecycleResult {
  isDuplicate: boolean;
  eventId: string;
  escrowId?: string;
}

/**
 * Executes an atomic escrow lifecycle transition:
 * BEGIN -> claim event -> lock escrow & transition state with prior-state guard -> mirror reservation -> mark event processed -> COMMIT.
 */
export async function executeEscrowLifecycleTransition(
  params: EscrowLifecycleParams
): Promise<EscrowLifecycleResult> {
  const {
    contractId,
    eventType,
    targetStatus,
    reservationStatus,
    rawPayload,
    amount,
    validPriorStates,
    tenantId = 'safetrust',
  } = params;

  return withTransaction(async (client) => {
    // 1 — Advisory transaction lock prevents concurrent duplicate processing for this event
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${tenantId}:${contractId}:${eventType}`,
    ]);

    // 2 — Check if event was already successfully processed (deduplication)
    const existing = await client.query<{ id: string }>(
      `SELECT id
       FROM safetrust.trustless_work_webhook_events
       WHERE contract_id = $1
         AND event_type  = $2
         AND processed   = true
         AND tenant_id   = $3
       LIMIT 1`,
      [contractId, eventType, tenantId]
    );

    if (existing.rows.length > 0) {
      return {
        isDuplicate: true,
        eventId: existing.rows[0].id,
      };
    }

    // 3 — Claim the event within the transaction (uncommitted until all steps succeed)
    const insertedEvent = await client.query<{ id: string }>(
      `INSERT INTO safetrust.trustless_work_webhook_events (
         contract_id,
         event_type,
         payload,
         processed,
         tenant_id
       ) VALUES ($1, $2, $3, false, $4)
       RETURNING id`,
      [contractId, eventType, JSON.stringify(rawPayload), tenantId]
    );
    const eventId = insertedEvent.rows[0].id;

    // 4 — Lock the escrow row and check current status
    const escrowResult = await client.query<{ id: string; status: string; balance?: number }>(
      `SELECT id, status, balance
       FROM safetrust.trustless_work_escrows
       WHERE contract_id = $1
       FOR UPDATE`,
      [contractId]
    );

    if (escrowResult.rowCount === 0) {
      throw new EscrowNotFoundError(`Escrow not found for contractId: ${contractId}`);
    }

    const escrow = escrowResult.rows[0];
    const escrowId = escrow.id;
    const currentStatus = escrow.status;

    // 5 — Idempotent completion check: if already at target status, mark processed and return
    if (currentStatus === targetStatus) {
      await mirrorReservationStatus(escrowId, reservationStatus, tenantId, client);
      await client.query(
        `UPDATE safetrust.trustless_work_webhook_events
         SET processed = true,
             processed_at = NOW()
         WHERE id = $1`,
        [eventId]
      );
      return {
        isDuplicate: true,
        eventId,
        escrowId,
      };
    }

    // 6 — Prior-state guard: verify current state is legal for this transition
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getValidPriorStates } = require('../../../crates/escrow-state-machine') as {
      getValidPriorStates: (to: string, event: string) => string;
    };
    const allowedStates: string[] =
      validPriorStates ??
      JSON.parse(getValidPriorStates(targetStatus, eventType) as string);

    if (!allowedStates.includes(currentStatus)) {
      throw new EscrowStateConflictError(
        `Escrow is not in a valid state for transition to ${targetStatus}`
      );
    }

    // 7 — Update escrow state and balance in safetrust.trustless_work_escrows
    const now = new Date().toISOString();
    if (amount !== undefined) {
      await client.query(
        `UPDATE safetrust.trustless_work_escrows
         SET status = $1,
             balance = $2,
             updated_at = $3
         WHERE id = $4`,
        [targetStatus, amount, now, escrowId]
      );
    } else {
      await client.query(
        `UPDATE safetrust.trustless_work_escrows
         SET status = $1,
             updated_at = $2
         WHERE id = $3`,
        [targetStatus, now, escrowId]
      );
    }

    // 8 — Mirror status to safetrust.reservations within the SAME transaction client
    await mirrorReservationStatus(escrowId, reservationStatus, tenantId, client);

    // 9 — Mark webhook event as processed within the transaction
    await client.query(
      `UPDATE safetrust.trustless_work_webhook_events
       SET processed = true,
           processed_at = $2
       WHERE id = $1`,
      [eventId, now]
    );

    return {
      isDuplicate: false,
      eventId,
      escrowId,
    };
  });
}

/**
 * Transactional lifecycle command to fund an escrow.
 * Wraps event claim + escrow state transition + reservation mirror in one atomic unit.
 */
export async function fundEscrowTransactional(
  contractId: string,
  amount: number,
  rawPayload: Record<string, unknown>
): Promise<EscrowLifecycleResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getValidPriorStates } = require('../../../crates/escrow-state-machine') as {
    getValidPriorStates: (to: string, event: string) => string;
  };
  const validStates: string[] = JSON.parse(
    getValidPriorStates(EscrowStatus.Funded, EscrowEventType.Funded) as string
  );

  return executeEscrowLifecycleTransition({
    contractId,
    eventType: EscrowEventType.Funded,
    targetStatus: EscrowStatus.Funded,
    reservationStatus: 'funded',
    amount,
    validPriorStates: validStates,
    rawPayload,
  });
}

/**
 * Transactional lifecycle command to release funds from an escrow.
 * Wraps event claim + escrow state transition + reservation mirror in one atomic unit.
 */
export async function releaseFundsTransactional(
  contractId: string,
  rawPayload: Record<string, unknown>
): Promise<EscrowLifecycleResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getValidPriorStates } = require('../../../crates/escrow-state-machine') as {
    getValidPriorStates: (to: string, event: string) => string;
  };
  const validStates: string[] = JSON.parse(
    getValidPriorStates(EscrowStatus.Completed, EscrowEventType.FundsReleased) as string
  );

  return executeEscrowLifecycleTransition({
    contractId,
    eventType: EscrowEventType.FundsReleased,
    targetStatus: EscrowStatus.Completed,
    reservationStatus: 'completed',
    amount: 0,
    validPriorStates: validStates,
    rawPayload,
  });
}

// ── Transaction Confirmation Lifecycle Exports ────────────────────────────────

export {
  LifecycleStage,
  EscrowAction,
  SubmissionPath,
  StellarNetwork,
  ConfirmationResult,
  ConfirmationRetryRecord,
  processHelperSubmission,
  processExternalSubmission,
  processPendingConfirmationRetries,
  verifyStellarTransaction,
  updateTWIndexerFromTxHash,
  sendTransactionViaTWHelper,
} from './confirmation.service';

/**
 * Validates that an unsubmitted signed XDR cannot advance escrow status or create records.
 * Wallet signing is purely client-side and unpersisted in DB.
 */
export function assertSignedXdrCannotAdvanceStatus(signedXdr: string): void {
  if (signedXdr && typeof signedXdr === 'string') {
    throw new EscrowValidationError(
      'Client-side wallet signing cannot advance escrow status; transaction must be submitted with a txHash',
      400
    );
  }
}
