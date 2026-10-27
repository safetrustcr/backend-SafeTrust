'use strict';

// Mock hasura service and zk-verifier before imports
jest.mock('../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
}));

jest.mock('../../services/db', () => ({
  query: jest.fn(),
}));

jest.mock('../../repositories/webhook-event.repository', () => ({
  getWebhookEventIdentity: jest.fn(() => 'test-event-identity'),
  logAndCheckWebhookEvent: jest.fn(),
  markWebhookEventProcessed: jest.fn(),
}));

jest.mock('../../lib/zk-verifier', () => ({
  verifyProofOfFunds: jest.fn(),
}));

// Mock amountToStroops from the shared lib to avoid any native addon chain
jest.mock('../../lib/stellar-amounts', () => ({
  amountToStroops: jest.fn((amount: unknown) => {
    // Minimal real-logic passthrough for the most common test values
    if (amount === 100) return '1000000000';
    if (amount === 0.0000001) return '1';
    return null;
  }),
}));

import {
  validateEscrowInitializationPayload,
  initializeEscrow,
  persistEscrow,
  linkReservationToEscrow,
  EscrowValidationError,
  ZkVerifierUnavailableError,
  ReservationNotFoundError,
  EscrowInitPayload,
} from '../../services/escrow.service';
import { hasuraRequest } from '../../services/hasura';
import { query } from '../../services/db';
import { TenantMismatchError } from '../../services/tenant-scoped-hasura';
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../repositories/webhook-event.repository';
import { verifyProofOfFunds } from '../../lib/zk-verifier';

const mockedHasuraRequest = hasuraRequest as jest.MockedFunction<typeof hasuraRequest>;
const mockedLogAndCheckWebhookEvent =
  logAndCheckWebhookEvent as jest.MockedFunction<typeof logAndCheckWebhookEvent>;
const mockedMarkWebhookEventProcessed =
  markWebhookEventProcessed as jest.MockedFunction<typeof markWebhookEventProcessed>;
const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedVerifyProof = verifyProofOfFunds as jest.MockedFunction<typeof verifyProofOfFunds>;

// ── Helpers ────────────────────────────────────────────────────────────────────

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    contract_id: 'contract-1',
    marker: 'GMARKER',
    approver: 'GAPPROVER',
    releaser: 'GRELEASER',
    amount: 100,
    escrow_type: 'single_release',
    ...overrides,
  };
}

function validPayload(overrides: Partial<EscrowInitPayload> = {}): EscrowInitPayload {
  const body = validBody();
  return {
    contract_id: 'contract-1',
    marker: 'GMARKER',
    approver: 'GAPPROVER',
    releaser: 'GRELEASER',
    resolver: null,
    amount: 100,
    escrow_type: 'single_release',
    asset_code: 'USDC',
    asset_issuer: null,
    booking_id: null,
    room_id: null,
    hotel_id: null,
    guest_id: null,
    booking_metadata: null,
    raw: body as any,
    ...overrides,
  };
}

// ── validateEscrowInitializationPayload ────────────────────────────────────────

describe('validateEscrowInitializationPayload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ZK_ENABLED = 'true'
    mockedVerifyProof.mockReturnValue(true);
  });

  it('returns a normalized payload for a valid body', () => {
    const result = validateEscrowInitializationPayload(validBody());

    expect(result.contract_id).toBe('contract-1');
    expect(result.escrow_type).toBe('single_release');
    expect(result.asset_code).toBe('USDC'); // default applied
    expect(result.resolver).toBeNull();
  });

  it('throws EscrowValidationError when required fields are missing', () => {
    expect(() => validateEscrowInitializationPayload({ contract_id: 'x' })).toThrow(
      EscrowValidationError
    );
  });

  it('throws EscrowValidationError with 400 status for missing fields', () => {
    expect.assertions(2);
    try {
      validateEscrowInitializationPayload({});
    } catch (err) {
      expect(err).toBeInstanceOf(EscrowValidationError);
      expect((err as EscrowValidationError).statusCode).toBe(400);
    }
  });

  it('rejects a zero escrow amount', () => {
    expect(() =>
      validateEscrowInitializationPayload(validBody({ amount: 0 }))
    ).toThrow(EscrowValidationError);
  });

  it.each([
    ['a non-numeric value', 'invalid'],
    ['a non-finite value', Number.NaN],
    ['an infinite value', Number.POSITIVE_INFINITY],
    ['a zero value', 0],
    ['a negative value', -1],
  ])('rejects %s amounts', (_description, amount) => {
    expect(() =>
      validateEscrowInitializationPayload(validBody({ amount }))
    ).toThrow(EscrowValidationError);
  });

  it('throws EscrowValidationError for an invalid escrow_type', () => {
    expect(() =>
      validateEscrowInitializationPayload(validBody({ escrow_type: 'invalid' }))
    ).toThrow(EscrowValidationError);
  });

  it('accepts both valid escrow_type values', () => {
    expect(() =>
      validateEscrowInitializationPayload(validBody({ escrow_type: 'multi_release' }))
    ).not.toThrow();
  });

  it('allows ZK bundle to be absent', () => {
    const result = validateEscrowInitializationPayload(validBody());
    expect(mockedVerifyProof).not.toHaveBeenCalled();
    expect(result.contract_id).toBe('contract-1');
  });

  it('throws EscrowValidationError for a partial ZK bundle', () => {
    expect(() =>
      validateEscrowInitializationPayload(validBody({ zk_proof: 'proof-hex' }))
    ).toThrow(EscrowValidationError);
    expect(mockedVerifyProof).not.toHaveBeenCalled();
  });

  it('throws EscrowValidationError when ZK threshold does not match amount', () => {
    expect(() =>
      validateEscrowInitializationPayload(
        validBody({
          zk_proof: 'proof-hex',
          zk_verification_key: 'vk-hex',
          zk_threshold_stroops: '999999999', // does not match 100 => 1000000000
          zk_balance_commitment: 'ab'.repeat(32),
        })
      )
    ).toThrow(EscrowValidationError);
    expect(mockedVerifyProof).not.toHaveBeenCalled();
  });

  it('throws EscrowValidationError when verifyProofOfFunds returns false', () => {
    mockedVerifyProof.mockReturnValue(false);
    expect(() =>
      validateEscrowInitializationPayload(
        validBody({
          zk_proof: 'bad-proof',
          zk_verification_key: 'vk-hex',
          zk_threshold_stroops: '1000000000',
          zk_balance_commitment: 'ab'.repeat(32),
        })
      )
    ).toThrow(EscrowValidationError);
  });

  it('throws ZkVerifierUnavailableError (503) when native verifier throws', () => {
    mockedVerifyProof.mockImplementation(() => {
      throw new Error('native addon missing');
    });
    let caught: unknown;
    try {
      validateEscrowInitializationPayload(
        validBody({
          zk_proof: 'proof-hex',
          zk_verification_key: 'vk-hex',
          zk_threshold_stroops: '1000000000',
          zk_balance_commitment: 'ab'.repeat(32),
        })
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ZkVerifierUnavailableError);
    expect((caught as ZkVerifierUnavailableError).statusCode).toBe(503);
  });

  it('calls verifyProofOfFunds with correct arguments for a complete bundle', () => {
    validateEscrowInitializationPayload(
      validBody({
        zk_proof: 'proof-hex',
        zk_verification_key: 'vk-hex',
        zk_threshold_stroops: '1000000000',
        zk_balance_commitment: 'ab'.repeat(32),
      })
    );
    expect(mockedVerifyProof).toHaveBeenCalledWith(
      'proof-hex',
      'vk-hex',
      '1000000000',
      'ab'.repeat(32)
    );
  });

  it('throws EscrowValidationError (500) when ZK verifier is misconfigured', () => {
    const error = new Error('misconfigured') as Error & { code?: string };
    error.code = 'ZK_VERIFIER_MISCONFIGURED';
    mockedVerifyProof.mockImplementation(() => {
      throw error;
    });

    expect(() =>
      validateEscrowInitializationPayload(
        validBody({
          zk_proof: 'proof-hex',
          zk_verification_key: 'vk-hex',
          zk_threshold_stroops: '1000000000',
          zk_balance_commitment: 'ab'.repeat(32),
        })
      )
    ).toThrow(expect.objectContaining({
      message: 'ZK proof verifier is misconfigured',
      statusCode: 500,
    }));
  });

  it('throws EscrowValidationError when ZK_ENFORCEMENT_ENABLED is true and bundle is missing', () => {
    const originalFlag = process.env.ZK_ENFORCEMENT_ENABLED;
    try {
      process.env.ZK_ENFORCEMENT_ENABLED = 'true';
      expect(() =>
        validateEscrowInitializationPayload(validBody())
      ).toThrow(expect.objectContaining({
        message: 'ZK proof of funds bundle is required for escrow initialization',
        statusCode: 400,
      }));
    } finally {
      process.env.ZK_ENFORCEMENT_ENABLED = originalFlag;
    }
  });
});


// ── initializeEscrow ──────────────────────────────────────────────────────────

describe('initializeEscrow', () => {
  const escrowResponse = {
    id: 'escrow-uuid-1',
    contractId: 'contract-1',
    status: 'created',
    createdAt: '2026-01-01T00:00:00Z',
    tenantId: 'safetrust',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedMarkWebhookEventProcessed.mockResolvedValue(undefined);
  });

  it('returns duplicate without persisting the escrow', async () => {
    mockedLogAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: true,
      eventId: 'event-duplicate',
    });

    const result = await initializeEscrow(validBody(), 'safetrust');

    expect(result).toEqual({
      isDuplicate: true,
      eventId: 'event-duplicate',
    });
    expect(mockedHasuraRequest).not.toHaveBeenCalled();
    expect(mockedMarkWebhookEventProcessed).toHaveBeenCalledWith(
      'event-duplicate'
    );
  });

  it('retries a duplicate whose earlier delivery did not finish', async () => {
    mockedLogAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: true,
      eventId: 'event-retry',
      processed: false,
    });
    mockedHasuraRequest.mockResolvedValueOnce({
      insert_trustless_work_escrows_one: escrowResponse,
    });

    const result = await initializeEscrow(validBody(), 'safetrust');

    expect(result).toEqual({
      isDuplicate: false,
      eventId: 'event-retry',
      escrow: escrowResponse,
    });
    expect(mockedMarkWebhookEventProcessed).toHaveBeenCalledWith('event-retry');
  });

  it('persists, links reservation, and marks the event processed', async () => {
    mockedLogAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: false,
      eventId: 'event-1',
    });
    mockedHasuraRequest
      .mockResolvedValueOnce({
        insert_trustless_work_escrows_one: escrowResponse,
      })
      .mockResolvedValueOnce({
        update_reservations: { affected_rows: 1 },
      });

    const body = validBody({ booking_metadata: { reservation_id: 'res-1' } });

    mockedQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'safetrust' }] } as any);

    const result = await initializeEscrow(body, 'safetrust');

    expect(result).toEqual({
      isDuplicate: false,
      eventId: 'event-1',
      escrow: escrowResponse,
    });
    expect(mockedHasuraRequest).toHaveBeenCalledTimes(2);
    expect(mockedMarkWebhookEventProcessed).toHaveBeenCalledWith('event-1');
  });

  it('uses the resolved reservation tenant for the escrow insert and the link', async () => {
    mockedLogAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: false,
      eventId: 'event-1',
    });
    mockedQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-b' }] } as any);
    mockedHasuraRequest
      .mockResolvedValueOnce({
        insert_trustless_work_escrows_one: { ...escrowResponse, tenantId: 'tenant-b' },
      })
      .mockResolvedValueOnce({ update_reservations: { affected_rows: 1 } });

    await initializeEscrow(
      validBody({ booking_metadata: { reservation_id: 'res-1' } }),
      'tenant-b'
    );

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('tenant_id'),
      ['res-1']
    );
    const insertVars = mockedHasuraRequest.mock.calls[0][1] as any;
    expect(insertVars.object.tenantId).toBe('tenant-b');
    const linkMutation = mockedHasuraRequest.mock.calls[1][0] as string;
    const linkVars = mockedHasuraRequest.mock.calls[1][1] as any;
    expect(linkMutation).toContain('tenantId: { _eq: $tenantId }');
    expect(linkVars).toEqual(
      expect.objectContaining({ reservationId: 'res-1', tenantId: 'tenant-b' })
    );
  });

  it('rejects an unknown reservation before any escrow write', async () => {
    mockedLogAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: false,
      eventId: 'event-1',
    });
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(
      initializeEscrow(
        validBody({ booking_metadata: { reservation_id: 'res-missing' } }),
        'safetrust'
      )
    ).rejects.toBeInstanceOf(ReservationNotFoundError);

    expect(mockedHasuraRequest).not.toHaveBeenCalled();
    expect(mockedMarkWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it('rejects a reservation owned by another tenant before any escrow write', async () => {
    mockedLogAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: false,
      eventId: 'event-1',
    });
    mockedQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-other' }] } as any);

    await expect(
      initializeEscrow(
        validBody({ booking_metadata: { reservation_id: 'res-1' } }),
        'safetrust'
      )
    ).rejects.toBeInstanceOf(TenantMismatchError);

    expect(mockedHasuraRequest).not.toHaveBeenCalled();
    expect(mockedMarkWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it('links an existing escrow whose tenant matches on retry', async () => {
    mockedLogAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: true,
      eventId: 'event-retry',
      processed: false,
    });
    mockedQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'safetrust' }] } as any);
    mockedHasuraRequest
      .mockResolvedValueOnce({ insert_trustless_work_escrows_one: escrowResponse })
      .mockResolvedValueOnce({ update_reservations: { affected_rows: 1 } });

    const result = await initializeEscrow(
      validBody({ booking_metadata: { reservation_id: 'res-1' } }),
      'safetrust'
    );

    expect(result.escrow).toEqual(escrowResponse);
    expect(mockedHasuraRequest).toHaveBeenCalledTimes(2);
    expect(mockedMarkWebhookEventProcessed).toHaveBeenCalledWith('event-retry');
  });

  it('rejects an existing escrow owned by another tenant before linking', async () => {
    mockedLogAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: true,
      eventId: 'event-retry',
      processed: false,
    });
    mockedQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'safetrust' }] } as any);
    mockedHasuraRequest.mockResolvedValueOnce({
      insert_trustless_work_escrows_one: { ...escrowResponse, tenantId: 'tenant-other' },
    });

    await expect(
      initializeEscrow(
        validBody({ booking_metadata: { reservation_id: 'res-1' } }),
        'safetrust'
      )
    ).rejects.toBeInstanceOf(TenantMismatchError);

    expect(mockedHasuraRequest).toHaveBeenCalledTimes(1);
    expect(mockedMarkWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it('does not mark the event processed when escrow persistence fails', async () => {
    mockedLogAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: false,
      eventId: 'event-failure',
    });
    mockedHasuraRequest.mockRejectedValue(
      new Error('Hasura request failed')
    );

    await expect(
      initializeEscrow(validBody(), 'safetrust')
    ).rejects.toThrow('Hasura request failed');

    expect(mockedMarkWebhookEventProcessed).not.toHaveBeenCalled();
  });
});

// ── persistEscrow ─────────────────────────────────────────────────────────────

describe('persistEscrow', () => {
  const escrowResponse = {
    id: 'escrow-uuid-1',
    contractId: 'contract-1',
    status: 'created',
    createdAt: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls hasuraRequest and returns the created escrow', async () => {
    mockedHasuraRequest.mockResolvedValue({
      insert_trustless_work_escrows_one: escrowResponse,
    });

    const result = await persistEscrow(validPayload(), 'safetrust');

    expect(mockedHasuraRequest).toHaveBeenCalledTimes(1);
    expect(mockedHasuraRequest).toHaveBeenCalledWith(
      expect.stringContaining('InitializeEscrow'),
      expect.objectContaining({
        object: expect.objectContaining({
          contractId: 'contract-1',
          status: 'created',
          tenantId: 'safetrust',
        }),
      })
    );

    const mutation = mockedHasuraRequest.mock.calls[0][0] as string;
    expect(mutation).toContain('on_conflict');
    expect(mutation).toContain(
      'constraint: trustless_work_escrows_contract_id_key'
    );
    expect(mutation).toContain('update_columns: [contractId]');

    expect(result).toEqual(escrowResponse);
  });

  it('writes the tenant passed by the caller instead of a literal', async () => {
    mockedHasuraRequest.mockResolvedValue({
      insert_trustless_work_escrows_one: escrowResponse,
    });

    await persistEscrow(validPayload(), 'tenant-b');

    const callArgs = mockedHasuraRequest.mock.calls[0][1] as any;
    expect(callArgs.object.tenantId).toBe('tenant-b');
  });

  it('throws when Hasura returns no escrow record', async () => {
    mockedHasuraRequest.mockResolvedValue({
      insert_trustless_work_escrows_one: undefined,
    });

    await expect(persistEscrow(validPayload(), 'safetrust')).rejects.toThrow(
      'Failed to insert escrow record'
    );
  });

  it('propagates Hasura errors upward', async () => {
    const err = Object.assign(new Error('Hasura request failed'), {
      details: [{ message: 'unique constraint violation' }],
    });
    mockedHasuraRequest.mockRejectedValue(err);

    await expect(persistEscrow(validPayload(), 'safetrust')).rejects.toThrow('Hasura request failed');
  });

  it('uses defaults for optional fields', async () => {
    mockedHasuraRequest.mockResolvedValue({
      insert_trustless_work_escrows_one: escrowResponse,
    });

    await persistEscrow(validPayload(), 'safetrust');

    const callArgs = mockedHasuraRequest.mock.calls[0][1] as any;
    expect(callArgs.object.assetCode).toBe('USDC');
    expect(callArgs.object.resolver).toBeNull();
    expect(callArgs.object.bookingId).toBeNull();
  });
});

// ── linkReservationToEscrow ───────────────────────────────────────────────────

describe('linkReservationToEscrow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls hasuraRequest with the correct reservationId and escrowId', async () => {
    mockedHasuraRequest.mockResolvedValue({
      update_reservations: { affected_rows: 1 },
    });

    await linkReservationToEscrow('res-1', 'escrow-1', 'safetrust');

    expect(mockedHasuraRequest).toHaveBeenCalledTimes(1);
    expect(mockedHasuraRequest).toHaveBeenCalledWith(
      expect.stringContaining('LinkEscrowToReservation'),
      expect.objectContaining({
        reservationId: 'res-1',
        escrowId: 'escrow-1',
        tenantId: 'safetrust',
      })
    );
  });

  it('throws when no reservation in the tenant matches', async () => {
    mockedHasuraRequest.mockResolvedValue({
      update_reservations: { affected_rows: 0 },
    });

    await expect(linkReservationToEscrow('res-1', 'escrow-1', 'safetrust')).rejects.toThrow(
      'Reservation res-1 was not linked'
    );
  });

  it('propagates Hasura errors upward', async () => {
    const err = Object.assign(new Error('Hasura request failed'), {
      details: [{ message: 'not found' }],
    });
    mockedHasuraRequest.mockRejectedValue(err);

    await expect(linkReservationToEscrow('res-missing', 'escrow-1', 'safetrust')).rejects.toThrow(
      'Hasura request failed'
    );
  });
});
