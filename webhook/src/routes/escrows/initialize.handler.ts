import { Request, Response } from 'express';
import { InitializeEscrowPayload } from '@safetrust/types';
import {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../services/hasura';
import { verifyProofOfFunds } from '../../lib/zk-verifier';

const EVENT_TYPE = 'escrow.initialized';
const STROOPS_PER_UNIT = 10_000_000n;
const U64_MAX = 18_446_744_073_709_551_615n;

/** Convert a positive decimal asset amount to an exact u64 stroop string. */
export function amountToStroops(amount: unknown): string | null {
  if (typeof amount !== 'string' && typeof amount !== 'number') return null;
  if (typeof amount === 'number') {
    const scaled = amount * Number(STROOPS_PER_UNIT);
    if (!Number.isSafeInteger(scaled) || scaled <= 0) return null;
    return BigInt(scaled).toString();
  }

  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(amount);
  if (!match) return null;

  const [, whole, fraction = ''] = match;
  if (whole.length > 13) return null;
  const excessFraction = fraction.slice(7);
  if (excessFraction && !/^0+$/.test(excessFraction)) return null;

  const fractionalStroops = (fraction.slice(0, 7) + '0000000').slice(0, 7);
  const stroops = BigInt(whole) * STROOPS_PER_UNIT + BigInt(fractionalStroops);
  if (stroops === 0n || stroops > U64_MAX) return null;

  return stroops.toString();
}

/** Normalize an untrusted decimal string to its canonical u64 representation. */
function normalizeU64(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) return null;
  if (value.length > 20) return null;

  const parsed = BigInt(value);
  if (parsed > U64_MAX) return null;
  return parsed.toString();
}

export const initializeEscrowHandler = async (
  req: Request<{}, {}, InitializeEscrowPayload>,
  res: Response
): Promise<Response> => {
  const {
    contract_id,
    marker,
    approver,
    releaser,
    resolver,
    amount,
    escrow_type,
    asset_code,
    asset_issuer,
    booking_id,
    room_id,
    hotel_id,
    guest_id,
    booking_metadata,
    zk_proof,
    zk_verification_key,
    zk_threshold_stroops,
    zk_balance_commitment,
  } = req.body;

  // 1 — Validate required fields
  if (!contract_id || !marker || !approver || !releaser || !amount || !escrow_type) {
    return res.status(400).json({
      error: 'Missing required fields: contract_id, marker, approver, releaser, amount, escrow_type'
    });
  }

  // 2 — Validate escrow_type matches migration CHECK constraint
  const validTypes = ['single_release', 'multi_release'];
  if (!validTypes.includes(escrow_type)) {
    return res.status(400).json({
      error: `escrow_type must be one of: ${validTypes.join(', ')}`
    });
  }

  // 3 — Verify an optional proof bundle before logging the event or writing
  // escrow state. Partial bundles and unavailable native verification fail closed.
  const zkValues = [
    zk_proof,
    zk_verification_key,
    zk_threshold_stroops,
    zk_balance_commitment,
  ];
  const hasZkBundle = zkValues.some((value) => value !== undefined && value !== null);
  if (hasZkBundle) {
    const hasCompleteBundle =
      typeof zk_proof === 'string' && zk_proof.length > 0 &&
      typeof zk_verification_key === 'string' && zk_verification_key.length > 0 &&
      typeof zk_threshold_stroops === 'string' && zk_threshold_stroops.length > 0 &&
      typeof zk_balance_commitment === 'string' && zk_balance_commitment.length > 0;

    if (!hasCompleteBundle) {
      return res.status(400).json({
        error: 'zk_proof, zk_verification_key, zk_threshold_stroops, and zk_balance_commitment must be supplied together'
      });
    }

    const expectedThreshold = amountToStroops(amount);
    const suppliedThreshold = normalizeU64(zk_threshold_stroops);
    if (!expectedThreshold || !suppliedThreshold || suppliedThreshold !== expectedThreshold) {
      return res.status(400).json({ error: 'Invalid ZK proof of funds' });
    }

    try {
      const isValidProof = verifyProofOfFunds(
        zk_proof,
        zk_verification_key,
        suppliedThreshold,
        zk_balance_commitment
      );
      if (!isValidProof) {
        return res.status(400).json({ error: 'Invalid ZK proof of funds' });
      }
    } catch (error) {
      const err = error as Error;
      console.error('[escrow/initialize] ZK verifier unavailable:', err.message);
      return res.status(503).json({ error: 'ZK proof verification is unavailable' });
    }
  }

  const mutation = `
    mutation InitializeEscrow($object: trustless_work_escrows_insert_input!) {
      insert_trustless_work_escrows_one(object: $object) {
        id
        contractId
        status
        createdAt
      }
    }
  `;

  try {
    // 4 — Idempotency check
    const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
      contract_id,
      EVENT_TYPE,
      req.body as unknown as Record<string, unknown>
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId);
      return res.status(200).json({ received: true });
    }

    // 5 — Persist to public.trustless_work_escrows via Hasura GraphQL mutation
    const data = await hasuraRequest<{ insert_trustless_work_escrows_one?: { id: string } }>(mutation, {
      object: {
        contractId: contract_id,
        marker,
        approver,
        releaser,
        resolver: resolver || null,
        escrowType: escrow_type,
        status: 'created',
        assetCode: asset_code || 'USDC',
        assetIssuer: asset_issuer || null,
        amount,
        balance: 0,
        bookingId: booking_id || null,
        roomId: room_id || null,
        hotelId: hotel_id || null,
        guestId: guest_id || null,
        tenantId: 'safetrust',
        escrowMetadata: req.body,
        bookingMetadata: booking_metadata || null,
      }
    });

    const escrow = data.insert_trustless_work_escrows_one;
    if (!escrow) {
      return res.status(500).json({ error: 'Failed to insert escrow record' });
    }

    // 6 — Link escrow to reservation AFTER escrow is confirmed to exist
    // booking_metadata.reservation_id is set by the frontend when BOOK was clicked
    const reservationId = booking_metadata?.reservation_id;
    if (reservationId) {
      const linkMutation = `
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

      await hasuraRequest(linkMutation, {
        reservationId,
        escrowId: escrow.id
      });

      console.log(`[escrow/initialize] Reservation linked — reservationId: ${reservationId}, escrowId: ${escrow.id}`);
    }

    console.log(`[escrow/initialize] ✅ Escrow persisted — contract_id: ${contract_id}, id: ${escrow.id}`);
    await markWebhookEventProcessed(eventId);
    return res.status(200).json({ received: true });

  } catch (error) {
    const err = error as Error & { details?: unknown };
    console.error('[escrow/initialize] ❌ Error:', err.details || err.message);
    if (err.details) {
      return res.status(500).json({ error: 'Failed to persist escrow record', details: err.details });
    }
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
};
