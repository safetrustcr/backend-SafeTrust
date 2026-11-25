'use strict';

jest.mock('../../db/pool', () => ({
  query: jest.fn(),
}));

jest.mock('../../repositories/webhook-event.repository', () => ({
  getWebhookEventIdentity: jest.fn(() => 'test-event-identity'),
  logAndCheckWebhookEvent: jest.fn(),
  markWebhookEventProcessed: jest.fn(),
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
  isEscrowParty,
  linkReservationToEscrow,
  EscrowValidationError,
  ReservationNotFoundError,
  EscrowInitPayload,
} from '../../services/escrow.service';
import { query } from '../../db/pool';
import { TenantMismatchError } from '../../utils/errors';
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../repositories/webhook-event.repository';

const mockedLogAndCheckWebhookEvent =
  logAndCheckWebhookEvent as jest.MockedFunction<typeof logAndCheckWebhookEvent>;
const mockedMarkWebhookEventProcessed =
  markWebhookEventProcessed as jest.MockedFunction<typeof markWebhookEventProcessed>;
const mockedQuery = query as jest.MockedFunction<typeof query>;

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
    reservation_id: null,
    booking_metadata: null,
    raw: body as any,
    ...overrides,
  };
}

// ── validateEscrowInitializationPayload ────────────────────────────────────────

describe('validateEscrowInitializationPayload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('ignores legacy zk_* fields in the payload and initializes successfully', () => {
    const payload = validBody({
      zk_proof: 'proof-hex',
      zk_verification_key: 'vk-hex',
      zk_threshold_stroops: '1000000000',
      zk_balance_commitment: 'ab'.repeat(32),
    });
    const result = validateEscrowInitializationPayload(payload);
    expect(result).toBeDefined();
    expect(result.contract_id).toBe('contract-1');
    expect(result.amount).toBe(100);
    expect(result.escrow_type).toBe('single_release');
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
    expect(mockedQuery).not.toHaveBeenCalled();
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
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: escrowResponse.id,
          contract_id: escrowResponse.contractId,
          status: escrowResponse.status,
          created_at: escrowResponse.createdAt,
          tenant_id: escrowResponse.tenantId,
        },
      ],
      rowCount: 1,
    } as any);

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
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'safetrust' }] } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            id: escrowResponse.id,
            contract_id: escrowResponse.contractId,
            status: escrowResponse.status,
            created_at: escrowResponse.createdAt,
            tenant_id: escrowResponse.tenantId,
          },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    const body = validBody({ booking_metadata: { reservation_id: 'res-1' } });

    const result = await initializeEscrow(body, 'safetrust');

    expect(result).toEqual({
      isDuplicate: false,
      eventId: 'event-1',
      escrow: escrowResponse,
    });
    expect(mockedQuery).toHaveBeenCalledTimes(3);
    expect(mockedMarkWebhookEventProcessed).toHaveBeenCalledWith('event-1');
  });

  it('uses the resolved reservation tenant for the escrow insert and the link', async () => {
    mockedLogAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: false,
      eventId: 'event-1',
    });
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-b' }] } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            id: escrowResponse.id,
            contract_id: escrowResponse.contractId,
            status: escrowResponse.status,
            created_at: escrowResponse.createdAt,
            tenant_id: 'tenant-b',
          },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    await initializeEscrow(
      validBody({ booking_metadata: { reservation_id: 'res-1' } }),
      'tenant-b'
    );

    expect(mockedQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('tenant_id'),
      ['res-1']
    );
    const insertParams = mockedQuery.mock.calls[1][1] as any[];
    expect(insertParams[11]).toBe('tenant-b');
    const linkSql = mockedQuery.mock.calls[2][0] as string;
    const linkParams = mockedQuery.mock.calls[2][1] as any[];
    expect(linkSql).toContain('AND tenant_id = $3');
    expect(linkParams).toEqual([escrowResponse.id, 'res-1', 'tenant-b']);
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

    expect(mockedQuery).toHaveBeenCalledTimes(1);
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

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedMarkWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it('links an existing escrow whose tenant matches on retry', async () => {
    mockedLogAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: true,
      eventId: 'event-retry',
      processed: false,
    });
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'safetrust' }] } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            id: escrowResponse.id,
            contract_id: escrowResponse.contractId,
            status: escrowResponse.status,
            created_at: escrowResponse.createdAt,
            tenant_id: escrowResponse.tenantId,
          },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    const result = await initializeEscrow(
      validBody({ booking_metadata: { reservation_id: 'res-1' } }),
      'safetrust'
    );

    expect(result.escrow).toEqual(escrowResponse);
    expect(mockedQuery).toHaveBeenCalledTimes(3);
    expect(mockedMarkWebhookEventProcessed).toHaveBeenCalledWith('event-retry');
  });

  it('rejects an existing escrow owned by another tenant before linking', async () => {
    mockedLogAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: true,
      eventId: 'event-retry',
      processed: false,
    });
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'safetrust' }] } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            id: escrowResponse.id,
            contract_id: escrowResponse.contractId,
            status: escrowResponse.status,
            created_at: escrowResponse.createdAt,
            tenant_id: 'tenant-other',
          },
        ],
        rowCount: 1,
      } as any);

    await expect(
      initializeEscrow(
        validBody({ booking_metadata: { reservation_id: 'res-1' } }),
        'safetrust'
      )
    ).rejects.toBeInstanceOf(TenantMismatchError);

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedMarkWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it('does not mark the event processed when escrow persistence fails', async () => {
    mockedLogAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: false,
      eventId: 'event-failure',
    });
    mockedQuery.mockRejectedValue(
      new Error('Database request failed')
    );

    await expect(
      initializeEscrow(validBody(), 'safetrust')
    ).rejects.toThrow('Database request failed');

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
    tenantId: 'safetrust',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('executes SQL upsert and returns the created escrow', async () => {
    mockedQuery.mockResolvedValue({
      rows: [
        {
          id: escrowResponse.id,
          contract_id: escrowResponse.contractId,
          status: escrowResponse.status,
          created_at: escrowResponse.createdAt,
          tenant_id: escrowResponse.tenantId,
        },
      ],
      rowCount: 1,
    } as any);

    const result = await persistEscrow(validPayload(), 'safetrust');

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO safetrust.trustless_work_escrows');
    expect(sql).toContain('ON CONFLICT (contract_id) DO UPDATE');
    expect(params).toEqual(
      expect.arrayContaining(['contract-1', 'created', 'safetrust'])
    );

    expect(result).toEqual(escrowResponse);

    const escrowMetadata = (params as any[])[12];
    expect(escrowMetadata.roles).toMatchObject({
      approver: 'GAPPROVER',
      serviceProvider: 'GMARKER',
      releaseSigner: 'GRELEASER',
    });
  });

  it('does not trust payer-supplied receiver role metadata', async () => {
    mockedQuery.mockResolvedValue({
      rows: [
        {
          id: escrowResponse.id,
          contract_id: escrowResponse.contractId,
          status: escrowResponse.status,
          created_at: escrowResponse.createdAt,
          tenant_id: escrowResponse.tenantId,
        },
      ],
      rowCount: 1,
    } as any);

    await persistEscrow(validPayload({
      raw: {
        ...validBody(),
        roles: { receiver: 'PAYER_CONTROLLED_WALLET' },
      } as any,
    }), 'safetrust');

    const params = mockedQuery.mock.calls[0][1] as any[];
    expect(params[12].roles.receiver).toBeNull();
    expect(params[12].roles.receiver).not.toBe('PAYER_CONTROLLED_WALLET');
  });

  it('writes the tenant passed by the caller instead of a literal', async () => {
    mockedQuery.mockResolvedValue({
      rows: [
        {
          id: escrowResponse.id,
          contract_id: escrowResponse.contractId,
          status: escrowResponse.status,
          created_at: escrowResponse.createdAt,
          tenant_id: 'tenant-b',
        },
      ],
      rowCount: 1,
    } as any);

    await persistEscrow(validPayload(), 'tenant-b');

    const params = mockedQuery.mock.calls[0][1] as any[];
    expect(params[11]).toBe('tenant-b');
  });

  it('throws when PostgreSQL returns no escrow record', async () => {
    mockedQuery.mockResolvedValue({
      rows: [],
      rowCount: 0,
    } as any);

    await expect(persistEscrow(validPayload(), 'safetrust')).rejects.toThrow(
      'Failed to insert escrow record'
    );
  });

  it('propagates database errors upward', async () => {
    const err = new Error('unique constraint violation');
    mockedQuery.mockRejectedValue(err);

    await expect(persistEscrow(validPayload(), 'safetrust')).rejects.toThrow(
      'unique constraint violation'
    );
  });

  it('uses defaults for optional fields', async () => {
    mockedQuery.mockResolvedValue({
      rows: [
        {
          id: escrowResponse.id,
          contract_id: escrowResponse.contractId,
          status: escrowResponse.status,
          created_at: escrowResponse.createdAt,
          tenant_id: escrowResponse.tenantId,
        },
      ],
      rowCount: 1,
    } as any);

    await persistEscrow(validPayload(), 'safetrust');

    const params = mockedQuery.mock.calls[0][1] as any[];
    expect(params[0]).toBe('contract-1');
    expect(params[7]).toBe('USDC');
    expect(params[4]).toBeNull();
  });
});

describe('isEscrowParty', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('authorizes against only the current Trustless Work V1 role metadata', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ is_party: true }] } as never);

    await expect(isEscrowParty('user-1', 'contract-1', 'tenant-1')).resolves.toBe(true);

    const [sql, params] = mockedQuery.mock.calls[0];
    expect(sql).toContain("escrow.escrow_metadata #>> '{roles,approver}'");
    expect(sql).toContain("escrow.escrow_metadata #>> '{roles,serviceProvider}'");
    expect(sql).toContain("escrow.escrow_metadata #>> '{roles,platformAddress}'");
    expect(sql).toContain("escrow.escrow_metadata #>> '{roles,releaseSigner}'");
    expect(sql).toContain("escrow.escrow_metadata #>> '{roles,disputeResolver}'");
    expect(sql).toContain("escrow.escrow_metadata #>> '{roles,receiver}'");
    expect(sql).not.toContain('escrow.approver,');
    expect(sql).not.toContain('escrow.marker,');
    expect(sql).not.toContain('escrow.releaser');
    expect(params).toEqual(['user-1', 'contract-1', 'tenant-1']);
  });
});

// ── linkReservationToEscrow ───────────────────────────────────────────────────

describe('linkReservationToEscrow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('executes SQL update with the correct reservationId and escrowId', async () => {
    mockedQuery.mockResolvedValue({
      rows: [],
      rowCount: 1,
    } as any);

    await linkReservationToEscrow('res-1', 'escrow-1', 'safetrust');

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE safetrust.reservations'),
      ['escrow-1', 'res-1', 'safetrust']
    );
  });

  it('throws when no reservation in the tenant matches', async () => {
    mockedQuery.mockResolvedValue({
      rows: [],
      rowCount: 0,
    } as any);

    await expect(linkReservationToEscrow('res-1', 'escrow-1', 'safetrust')).rejects.toThrow(
      'Reservation res-1 was not linked'
    );
  });

  it('propagates database errors upward', async () => {
    const err = new Error('Database request failed');
    mockedQuery.mockRejectedValue(err);

    await expect(linkReservationToEscrow('res-missing', 'escrow-1', 'safetrust')).rejects.toThrow(
      'Database request failed'
    );
  });
});
