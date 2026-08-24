import { Request, Response } from 'express';
import {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../services/hasura';
import {
  notifyHotelEscrowConversation,
} from '../../services/hotel-conversation-notify';
import type { FundEscrowPayload } from '@safetrust/types';

const EVENT_TYPE = 'escrow.funded';

export const fundEscrowHandler = async (
  req: Request<{}, {}, FundEscrowPayload>,
  res: Response
): Promise<Response> => {
  const { contractId, signer, amount } = req.body as any;

  if (!contractId || !signer || amount === undefined || amount === null) {
    return res.status(400).json({
      error: 'Missing required fields: contractId, signer, amount',
    });
  }

  if (amount <= 0) {
    return res.status(400).json({
      error: 'Amount cannot be zero or negative',
    });
  }

  try {
    const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
      contractId,
      EVENT_TYPE,
      req.body as Record<string, unknown>
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId);
      return res.status(200).json({ received: true });
    }

    const mutation = `
      mutation FundEscrow($contractId: String!, $amount: numeric!) {
        update_trustless_work_escrows(
          where: {
            contractId: { _eq: $contractId }
            status: { _in: ["created", "pending_funding"] }
          }
          _set: {
            status: "funded"
            balance: $amount
          }
        ) {
          returning {
            id
            contractId
            status
            balance
          }
        }
      }
    `;

    const data: any = await hasuraRequest(mutation, { contractId, amount });
    const updated = data.update_trustless_work_escrows?.returning;

    if (!updated || !updated.length) {
      return res.status(404).json({
        error: `Escrow not found for contractId: ${contractId}`,
      });
    }

    const escrowId = updated[0].id;

    const mirrorMutation = `
      mutation MirrorFundedToReservation($escrowId: uuid!) {
        update_safetrust_reservations(
          where: { escrowId: { _eq: $escrowId } }
          _set: {
            status: "funded"
            updatedAt: "now()"
          }
        ) {
          returning { id status }
        }
      }
    `;

    await hasuraRequest(mirrorMutation, { escrowId });

    await notifyHotelEscrowConversation({
      contractId,
      eventType: 'escrow_funded',
      body: 'SafeTrust: Your deposit has been confirmed on the Stellar network. Your booking is secured.',
    });

    await markWebhookEventProcessed(eventId);
    return res.status(200).json({ received: true });
  } catch (error) {
    const err = error as Error & { details?: unknown };
    console.error('[escrow/fund] error:', err.details ?? err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
