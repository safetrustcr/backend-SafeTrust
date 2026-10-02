import { InitializeEscrowPayload } from '@safetrust/types';
import { hasuraRequest } from './hasura';
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../repositories/webhook-event.repository';
import { amountToStroops } from '../lib/stellar-amounts';
import { verifyProofOfFunds } from '../lib/zk-verifier';

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
  amount: number;
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
}

// ── Validation error ───────────────────────────────────────────────────────────

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
  
  // 3 — Optional ZK proof bundle: must be all-or-nothing; validates threshold
  const zkValues = [zk_proof, zk_verification_key, zk_threshold_stroops, zk_balance_commitment];
  const hasZkBundle = zkValues.some((v) => v !== undefined && v !== null);

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
      const error = err as Error;
      console.error('[escrow.service] ZK verifier unavailable:', error.message);
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
  payload: EscrowInitPayload
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
      }
    }
  `;

  const data = await hasuraRequest<{
    insert_trustless_work_escrows_one?: TrustlessWorkEscrow;
  }>(mutation, {
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
      tenantId: 'safetrust',
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

/**
 * Update a reservation row to link it to the created escrow.
 * No-op when reservationId is null or undefined.
 */
export async function linkReservationToEscrow(
  reservationId: string,
  escrowId: string
): Promise<void> {
  const mutation = `
    mutation LinkEscrowToReservation($reservationId: uuid!, $escrowId: uuid!) {
      update_reservations_by_pk(
        pk_columns: { id: $reservationId }
        _set: {
          escrow_id: $escrowId,
          status: "escrow_created",
          updatedAt: "now()"
        }
      ) {
        id status escrow_id
      }
    }
  `;

  await hasuraRequest(mutation, { reservationId, escrowId });

  console.log(
    `[escrow.service] Reservation linked — reservationId: ${reservationId}, escrowId: ${escrowId}`
  );
}


/**
 * Processes an escrow initialization webhook with idempotency protection.
 */
export async function initializeEscrow(
  payload: EscrowInitPayload,
  rawPayload: Record<string, unknown>
): Promise<{ isDuplicate: boolean; eventId: string; escrow?: TrustlessWorkEscrow }> {
  const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
    payload.contract_id,
    'escrow.initialized',
    rawPayload
  );

  if (isDuplicate) {
    await markWebhookEventProcessed(eventId);
    return { isDuplicate: true, eventId };
  }

  const escrow = await persistEscrow(payload);

  const reservationId = payload.booking_metadata?.reservation_id;
  if (reservationId) {
    await linkReservationToEscrow(reservationId, escrow.id);
  }

  await markWebhookEventProcessed(eventId);

  return { isDuplicate: false, eventId, escrow };
}
