'use strict';

jest.mock('../../../services/escrow.service', () => ({
  EscrowValidationError: class EscrowValidationError extends Error {
    constructor(message: string, readonly statusCode = 400) {
      super(message);
    }
  },
  ReservationNotFoundError: class ReservationNotFoundError extends Error {},
  TenantMismatchError: class TenantMismatchError extends Error {},
  ZkVerifierUnavailableError: class ZkVerifierUnavailableError extends Error {},
  initializeEscrow: jest.fn(),
}));

const { initializeEscrowHandler, amountToStroops } = require('../initialize.handler');
const {
  EscrowValidationError,
  initializeEscrow,
} = require('../../../services/escrow.service');

function makeRequest(overrides = {}) {
  return {
    body: {
      contract_id: 'contract-1',
      marker: 'GMARKER',
      approver: 'GAPPROVER',
      releaser: 'GRELEASER',
      amount: 100,
      escrow_type: 'single_release',
      ...overrides,
    },
  };
}

function makeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('initializeEscrowHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initializeEscrow.mockResolvedValue({
      isDuplicate: false,
      eventId: 'event-1',
      escrow: { id: 'escrow-1' },
    });
    delete process.env.PLATFORM_TENANT_ID;
  });

  it('delegates initialization to the service with the request body and platform tenant', async () => {
    process.env.PLATFORM_TENANT_ID = 'tenant-b';
    const req = makeRequest();
    const res = makeResponse();

    await initializeEscrowHandler(req, res);

    expect(initializeEscrow).toHaveBeenCalledWith(req.body, 'tenant-b');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('responds with the duplicate event when the service detects a duplicate', async () => {
    initializeEscrow.mockResolvedValue({
      isDuplicate: true,
      eventId: 'event-duplicate',
    });
    const res = makeResponse();

    await initializeEscrowHandler(makeRequest(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      duplicate: true,
      eventId: 'event-duplicate',
    });
  });

  it.each([
    ['a non-numeric value', 'not-an-amount'],
    ['a non-finite value', Number.POSITIVE_INFINITY],
    ['a NaN value', Number.NaN],
    ['zero', 0],
    ['a null value', null],
    ['a negative value', -1],
  ])('rejects %s before calling the service', async (_description, amount) => {
    const res = makeResponse();

    await initializeEscrowHandler(makeRequest({ amount }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(initializeEscrow).not.toHaveBeenCalled();
  });

  it('rejects malformed amount types before calling the service', async () => {
    const res = makeResponse();

    await initializeEscrowHandler(makeRequest({ amount: { value: 100 } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(initializeEscrow).not.toHaveBeenCalled();
  });

  it('maps service validation errors to a bad request', async () => {
    initializeEscrow.mockRejectedValueOnce(new EscrowValidationError('invalid payload'));
    const res = makeResponse();

    await initializeEscrowHandler(makeRequest(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'invalid payload' });
  });
});

describe('amountToStroops', () => {
  it('converts positive whole and fractional asset amounts', () => {
    expect(amountToStroops(100)).toBe('1000000000');
    expect(amountToStroops(0.0000001)).toBe('1');
    expect(amountToStroops('1.2345678')).toBe('12345678');
    expect(amountToStroops('0.0000001')).toBe('1');
  });

  it('rejects sub-stroop precision, zero, and u64 overflow', () => {
    expect(amountToStroops('1.00000001')).toBeNull();
    expect(amountToStroops('0')).toBeNull();
    expect(amountToStroops('1844674407370.9551616')).toBeNull();
  });
});
