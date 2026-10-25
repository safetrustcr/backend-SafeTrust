
import { Request, Response } from 'express';
import { badRequest, conflict, duplicate, notFound, ok, serverError } from '../../utils/response';
import { ReleaseFundsPayload } from '@safetrust/types';
import { processWebhookEvent } from '../../repositories/webhook-event.repository';
import { releaseFundsInTransaction } from '../../repositories/escrow.repository';
import { mirrorReservationStatusInTransaction } from '../../repositories/reservation.repository';
import { notifyHotelEscrowConversation } from '../../services/hotel-conversation-notify';
import { getPlatformTenantId } from '../../config/tenant';
import { EscrowEventType, EscrowStatus } from '../../types/escrow.types';
import {
  getValidPriorStates,
  StateConflictError,
} from '../../lib/escrow-transitions';

const EVENT_TYPE = EscrowEventType.FundsReleased;

/**
 * Handles the escrow release-funds webhook event.
 * Atomically transitions the escrow to 'completed', mirrors reservation status,
 * and notifies hotel conversation. Supports idempotent retry if already completed.
 *
 * @param req - Express request containing ReleaseFundsPayload
 * @param res - Express response object
 * @returns Express response indicating success, duplicate, conflict, or error
 */
export const releaseFundsHandler = async (
  req: Request<{}, {}, ReleaseFundsPayload>,
  res: Response
): Promise<Response> => {
  const { contractId, releaseSigner } = req.body;

  if (!contractId || !releaseSigner) {
    return badRequest(res, {
      error: 'Missing required fields: contractId, releaseSigner',
    });
  }

  try {
    // 1 — Claim the event and apply database state changes atomically
    const { isDuplicate, eventId, result: updated } = await processWebhookEvent(
      contractId,
      EVENT_TYPE,
      req.body as unknown as Record<string, unknown>,
      async (client) => {
        const validStates: string[] = getValidPriorStates(
          EscrowStatus.Completed,
          EscrowEventType.FundsReleased
        );

        const escrow = await releaseFundsInTransaction(
          client,
          contractId,
          validStates
        );

        if (escrow) {
          await mirrorReservationStatusInTransaction(
            client,
            escrow.id,
            'completed',
            getPlatformTenantId()
          );

          return { escrow, alreadyCompleted: false };
        }

        // Retry after partial failure or recovery: check current escrow in DB
        const existing = await client.query<{
          id: string;
          contract_id: string;
          status: string;
          balance: number;
        }>(
          `SELECT id, contract_id, status, balance
           FROM safetrust.trustless_work_escrows
           WHERE contract_id = $1 AND tenant_id = 'safetrust'`,
          [contractId]
        );

        if (existing.rows.length === 0) {
          return null;
        }

        const current = existing.rows[0];

        if (current.status === 'completed') {
          // Check if this is a retry of an earlier incomplete event for the same contract
          const incompleteEvents = await client.query<{ id: string }>(
            `SELECT id
             FROM safetrust.trustless_work_webhook_events
             WHERE tenant_id = 'safetrust'
               AND contract_id = $1
               AND event_type = $2
               AND processed = false`,
            [contractId, EVENT_TYPE]
          );

          // The current transaction already claimed one event row (processed = false).
          // More than 1 unprocessed event means a prior incomplete event is being retried.
          const isRetryOfIncomplete = incompleteEvents.rows.length > 1;

          if (isRetryOfIncomplete) {
            await mirrorReservationStatusInTransaction(
              client,
              current.id,
              'completed',
              getPlatformTenantId()
            );
            return {
              escrow: {
                id: current.id,
                contractId: current.contract_id,
                status: current.status,
                balance: current.balance,
              },
              alreadyCompleted: true,
            };
          }

          // New release event for an already completed escrow: reject with StateConflictError
          throw new StateConflictError(
            `Escrow cannot transition to completed: contractId '${contractId}' current status 'completed' not in [${validStates.join(', ')}]`
          );
        }

        // Real invalid prior state: throw StateConflictError so handler returns 409
        throw new StateConflictError(
          `Escrow cannot transition to completed: contractId '${contractId}' current status '${current.status}' not in [${validStates.join(', ')}]`
        );
      }
    );

    if (isDuplicate) {
      return duplicate(res, eventId);
    }

    if (!updated) {
      return notFound(res, {
        error: `Escrow not found for contractId: ${contractId}`,
      });
    }

    if (updated.alreadyCompleted) {
      // Replay of a completed escrow: reservation is mirrored, so skip redundant guest notification
      return ok(res);
    }

    // 2 — Notify hotel conversation after the state transaction commits
    await notifyHotelEscrowConversation({
      contractId,
      eventType: 'escrow_completed',
      body: 'SafeTrust: Funds have been released. Thank you for booking with us.',
    });

    console.log(
      `[escrow/release-funds] ✅ Funds released — contractId: ${contractId}`
    );

    return ok(res);
  } catch (error) {
    const err = error as Error & { details?: unknown };

    if (err instanceof StateConflictError) {
      console.warn(
        `[escrow/release-funds] ⚠️ State conflict: ${err.message}`
      );

      return conflict(res, { error: err.message });
    }

    console.error(
      '[escrow/release-funds] ❌ error:',
      err.details || err.message
    );

    if (err.details) {
      return serverError(res, {
        error: 'Failed to update escrow status',
        details: err.details,
      });
    }

    return serverError(res, {
      error: 'Internal server error',
      details: err.message,
    });
  }
};
