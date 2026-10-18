'use strict';

// Mock hasura service and zk-verifier before imports
jest.mock('../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
}));

jest.mock('../../repositories/webhook-event.repository', () => ({
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
  EscrowInitPayload,
} from '../../services/escrow.service';
import { hasuraRequest } from '../../services/hasura';
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
});


// ── initializeEscrow ──────────────────────────────────────────────────────────

describe('initializeEscrow', () => {
  const escrowResponse = {
    id: 'escrow-uuid-1',
    contractId: 'contract-1',
    status: 'created',
    createdAt: '2026-01-01T00:00:00Z',
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

    const result = await initializeEscrow(validPayload(), validBody());

    expect(result).toEqual({
      isDuplicate: true,
      eventId: 'event-duplicate',
    });
    expect(mockedHasuraRequest).not.toHaveBeenCalled();
    expect(mockedMarkWebhookEventProcessed).toHaveBeenCalledWith(
      'event-duplicate'
    );
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
        update_reservations_by_pk: {
          id: 'res-1',
          status: 'escrow_created',
          escrow_id: 'escrow-uuid-1',
        },
      });

    const payload = validPayload({
      booking_metadata: { reservation_id: 'res-1' },
    });

    const result = await initializeEscrow(payload, validBody());

    expect(result).toEqual({
      isDuplicate: false,
      eventId: 'event-1',
      escrow: escrowResponse,
    });
    expect(mockedHasuraRequest).toHaveBeenCalledTimes(2);
    expect(mockedMarkWebhookEventProcessed).toHaveBeenCalledWith('event-1');
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
      initializeEscrow(validPayload(), validBody())
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

    const result = await persistEscrow(validPayload());

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

  it('throws when Hasura returns no escrow record', async () => {
    mockedHasuraRequest.mockResolvedValue({
      insert_trustless_work_escrows_one: undefined,
    });

    await expect(persistEscrow(validPayload())).rejects.toThrow(
      'Failed to insert escrow record'
    );
  });

  it('propagates Hasura errors upward', async () => {
    const err = Object.assign(new Error('Hasura request failed'), {
      details: [{ message: 'unique constraint violation' }],
    });
    mockedHasuraRequest.mockRejectedValue(err);

    await expect(persistEscrow(validPayload())).rejects.toThrow('Hasura request failed');
  });

  it('uses defaults for optional fields', async () => {
    mockedHasuraRequest.mockResolvedValue({
      insert_trustless_work_escrows_one: escrowResponse,
    });

    await persistEscrow(validPayload());

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
      update_reservations_by_pk: { id: 'res-1', status: 'escrow_created', escrow_id: 'escrow-1' },
    });

    await linkReservationToEscrow('res-1', 'escrow-1');

    expect(mockedHasuraRequest).toHaveBeenCalledTimes(1);
    expect(mockedHasuraRequest).toHaveBeenCalledWith(
      expect.stringContaining('LinkEscrowToReservation'),
      expect.objectContaining({
        reservationId: 'res-1',
        escrowId: 'escrow-1',
      })
    );
  });

  it('propagates Hasura errors upward', async () => {
    const err = Object.assign(new Error('Hasura request failed'), {
      details: [{ message: 'not found' }],
    });
    mockedHasuraRequest.mockRejectedValue(err);

    await expect(linkReservationToEscrow('res-missing', 'escrow-1')).rejects.toThrow(
      'Hasura request failed'
    );
  });
});
