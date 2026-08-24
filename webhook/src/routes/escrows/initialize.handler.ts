import { Request, Response } from 'express';
import {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../services/hasura';
import type { InitializeEscrowPayload } from '@safetrust/types';

const EVENT_TYPE = 'escrow.initialized';

export const initializeEscrowHandler = async (
  req: Request<{}, {}, InitializeEscrowPayload>,
  res: Response
): Promise<Response> => {
  const {
    contract_id,
    marker,
    approver,
    releaser,
    service_provider,
    client,
    amount,
    title,
    description,
    milestones,
  } = req.body as any;

  if (!contract_id || !service_provider || !client) {
    return res.status(400).json({
      error: 'Missing required fields: contract_id, service_provider, client',
    });
  }

  try {
    const { isDuplicate, eventId } = await logAndCheckWebhookEvent(
      contract_id,
      EVENT_TYPE,
      req.body as Record<string, unknown>
    );

    if (isDuplicate) {
      await markWebhookEventProcessed(eventId);
      return res.status(200).json({ received: true });
    }

    const mutation = `
      mutation InitializeEscrow($contract_id: String!, $marker: String, $approver: String, $releaser: String, $service_provider: String!, $client: String!, $amount: numeric, $title: String, $description: String) {
        insert_trustless_work_escrows_one(
          object: {
            contractId: $contract_id
            marker: $marker
            approver: $approver
            releaser: $releaser
            serviceProvider: $service_provider
            client: $client
            balance: $amount
            title: $title
            description: $description
            status: "created"
          }
        ) {
          id
          contractId
          status
        }
      }
    `;

    await hasuraRequest(mutation, {
      contract_id,
      marker,
      approver,
      releaser,
      service_provider,
      client,
      amount,
      title,
      description,
    });

    await markWebhookEventProcessed(eventId);
    return res.status(200).json({ received: true });
  } catch (error) {
    const err = error as Error & { details?: unknown };
    console.error('[escrow/initialize] error:', err.details ?? err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
