export {};
'use strict';

jest.mock('../../../repositories/webhook-event.repository', () => ({
  logAndCheckWebhookEvent: jest.fn(),
  markWebhookEventProcessed: jest.fn(),
}));

jest.mock('../../../repositories/escrow.repository', () => ({
  createEscrow: jest.fn(),
  getEscrowByContractId: jest.fn(),
}));

jest.mock('../../../repositories/reservation.repository', () => ({
  findReservationTenantId: jest.fn(),
  linkEscrowToReservation: jest.fn(),
}));

jest.mock('../../../lib/zk-verifier', () => ({
  verifyProofOfFunds: jest.fn(),
}));

const { initializeEscrowHandler, amountToStroops } = require('../initialize.handler');
const {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} = require('../../../repositories/webhook-event.repository');
const {
  createEscrow,
  getEscrowByContractId,
} = require('../../../repositories/escrow.repository');
const {
  findReservationTenantId,
  linkEscrowToReservation,
} = require('../../../repositories/reservation.repository');
const { verifyProofOfFunds } = require('../../../lib/zk-verifier');

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

describe('initializeEscrowHandler ZK verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ZK_ENABLED = 'true'
    verifyProofOfFunds.mockReturnValue(true);
    logAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: false,
      eventId: 'event-1',
    });
    createEscrow.mockResolvedValue({
      id: 'escrow-1',
      contractId: 'contract-1',
      status: 'created',
      createdAt: '2026-08-24T00:00:00Z',
    });
    markWebhookEventProcessed.mockResolvedValue(undefined);
  });

  it('keeps ZK verification optional', async () => {
    const res = makeResponse();
    await initializeEscrowHandler(makeRequest(), res);

    expect(verifyProofOfFunds).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('verifies a complete proof bundle before persisting', async () => {
    const req = makeRequest({
      zk_proof: 'proof-hex',
      zk_verification_key: 'vk-hex',
      zk_threshold_stroops: '1000000000',
      zk_balance_commitment: 'ab'.repeat(32),
    });
    const res = makeResponse();
    await initializeEscrowHandler(req, res);

    expect(verifyProofOfFunds).toHaveBeenCalledWith(
      'proof-hex',
      'vk-hex',
      '1000000000',
      'ab'.repeat(32)
    );
    expect(logAndCheckWebhookEvent).toHaveBeenCalledTimes(1);
    expect(createEscrow).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects a partial proof bundle without side effects', async () => {
    const res = makeResponse();
    await initializeEscrowHandler(makeRequest({ zk_proof: 'proof-hex' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(verifyProofOfFunds).not.toHaveBeenCalled();
    expect(logAndCheckWebhookEvent).not.toHaveBeenCalled();
    expect(createEscrow).not.toHaveBeenCalled();
  });

  it('rejects an invalid proof without side effects', async () => {
    verifyProofOfFunds.mockReturnValue(false);
    const res = makeResponse();
    await initializeEscrowHandler(makeRequest({
      zk_proof: 'bad-proof',
      zk_verification_key: 'vk-hex',
      zk_threshold_stroops: '1000000000',
      zk_balance_commitment: 'ab'.repeat(32),
    }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Invalid ZK proof of funds' });
    expect(logAndCheckWebhookEvent).not.toHaveBeenCalled();
    expect(createEscrow).not.toHaveBeenCalled();
  });

  it('rejects a valid proof whose threshold does not match the escrow amount', async () => {
    const res = makeResponse();
    await initializeEscrowHandler(makeRequest({
      zk_proof: 'valid-proof-for-a-different-threshold',
      zk_verification_key: 'vk-hex',
      zk_threshold_stroops: '999999999',
      zk_balance_commitment: 'ab'.repeat(32),
    }), res);

    expect(verifyProofOfFunds).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Invalid ZK proof of funds' });
    expect(logAndCheckWebhookEvent).not.toHaveBeenCalled();
    expect(createEscrow).not.toHaveBeenCalled();
  });

  it('fails closed when the native verifier is unavailable', async () => {
    verifyProofOfFunds.mockImplementation(() => {
      throw new Error('native addon missing');
    });
    const res = makeResponse();
    await initializeEscrowHandler(makeRequest({
      zk_proof: 'proof-hex',
      zk_verification_key: 'vk-hex',
      zk_threshold_stroops: '1000000000',
      zk_balance_commitment: 'ab'.repeat(32),
    }), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(logAndCheckWebhookEvent).not.toHaveBeenCalled();
    expect(createEscrow).not.toHaveBeenCalled();
  });

  it('returns 500 when the ZK verifier is misconfigured', async () => {
    const error = new Error('misconfigured') as Error & { code?: string };
    error.code = 'ZK_VERIFIER_MISCONFIGURED';
    verifyProofOfFunds.mockImplementation(() => {
      throw error;
    });
    const res = makeResponse();
    await initializeEscrowHandler(makeRequest({
      zk_proof: 'proof-hex',
      zk_verification_key: 'vk-hex',
      zk_threshold_stroops: '1000000000',
      zk_balance_commitment: 'ab'.repeat(32),
    }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'ZK proof verifier is misconfigured' }));
    expect(logAndCheckWebhookEvent).not.toHaveBeenCalled();
    expect(createEscrow).not.toHaveBeenCalled();
  });

  it('rejects missing ZK proof bundle when ZK_ENFORCEMENT_ENABLED is true', async () => {
    const originalFlag = process.env.ZK_ENFORCEMENT_ENABLED;
    try {
      process.env.ZK_ENFORCEMENT_ENABLED = 'true';
      const res = makeResponse();
      await initializeEscrowHandler(makeRequest(), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'ZK proof of funds bundle is required for escrow initialization',
      }));
      expect(logAndCheckWebhookEvent).not.toHaveBeenCalled();
      expect(createEscrow).not.toHaveBeenCalled();
    } finally {
      process.env.ZK_ENFORCEMENT_ENABLED = originalFlag;
    }
  });
});

describe('initializeEscrowHandler tenant and retry', () => {
  const escrow = {
    id: 'escrow-1',
    contractId: 'contract-1',
    status: 'created',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ZK_ENABLED;
    delete process.env.PLATFORM_TENANT_ID;
    createEscrow.mockResolvedValue(escrow);
    findReservationTenantId.mockResolvedValue('safetrust');
    linkEscrowToReservation.mockResolvedValue(undefined);
    markWebhookEventProcessed.mockResolvedValue(undefined);
  });

  afterAll(() => {
    delete process.env.PLATFORM_TENANT_ID;
  });

  it('writes the configured platform tenant to the escrow and reservation link', async () => {
    process.env.PLATFORM_TENANT_ID = 'tenant-b';
    findReservationTenantId.mockResolvedValue('tenant-b');
    logAndCheckWebhookEvent.mockResolvedValue({ isDuplicate: false, eventId: 'event-1' });

    const res = makeResponse();
    await initializeEscrowHandler(
      makeRequest({ booking_metadata: { reservation_id: 'res-1' } }),
      res
    );

    expect(createEscrow).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-b' }));
    expect(linkEscrowToReservation).toHaveBeenCalledWith('res-1', 'escrow-1', 'tenant-b');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('uses the resolved reservation tenant for both the escrow and the link', async () => {
    findReservationTenantId.mockResolvedValue('safetrust');
    logAndCheckWebhookEvent.mockResolvedValue({ isDuplicate: false, eventId: 'event-1' });

    const res = makeResponse();
    await initializeEscrowHandler(
      makeRequest({ booking_metadata: { reservation_id: 'res-1' } }),
      res
    );

    expect(findReservationTenantId).toHaveBeenCalledWith('res-1');
    expect(createEscrow).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'safetrust' }));
    expect(linkEscrowToReservation).toHaveBeenCalledWith('res-1', 'escrow-1', 'safetrust');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects an unknown reservation before any escrow write', async () => {
    findReservationTenantId.mockResolvedValue(null);
    logAndCheckWebhookEvent.mockResolvedValue({ isDuplicate: false, eventId: 'event-1' });

    const res = makeResponse();
    await initializeEscrowHandler(
      makeRequest({ booking_metadata: { reservation_id: 'res-missing' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(createEscrow).not.toHaveBeenCalled();
    expect(getEscrowByContractId).not.toHaveBeenCalled();
    expect(linkEscrowToReservation).not.toHaveBeenCalled();
    expect(markWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it('rejects a reservation owned by another tenant before any escrow write', async () => {
    findReservationTenantId.mockResolvedValue('tenant-other');
    logAndCheckWebhookEvent.mockResolvedValue({ isDuplicate: false, eventId: 'event-1' });

    const res = makeResponse();
    await initializeEscrowHandler(
      makeRequest({ booking_metadata: { reservation_id: 'res-1' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(createEscrow).not.toHaveBeenCalled();
    expect(linkEscrowToReservation).not.toHaveBeenCalled();
    expect(markWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it('leaves the event unprocessed when the reservation link fails', async () => {
    logAndCheckWebhookEvent.mockResolvedValue({ isDuplicate: false, eventId: 'event-1' });
    linkEscrowToReservation.mockRejectedValue(new Error('Reservation res-1 was not linked'));

    const res = makeResponse();
    await initializeEscrowHandler(
      makeRequest({ booking_metadata: { reservation_id: 'res-1' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(markWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it('retries an unprocessed duplicate, reusing the escrow already created', async () => {
    logAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: true,
      eventId: 'event-1',
      processed: false,
    });
    getEscrowByContractId.mockResolvedValue(escrow);

    const res = makeResponse();
    await initializeEscrowHandler(
      makeRequest({ booking_metadata: { reservation_id: 'res-1' } }),
      res
    );

    expect(createEscrow).not.toHaveBeenCalled();
    expect(linkEscrowToReservation).toHaveBeenCalledWith('res-1', 'escrow-1', 'safetrust');
    expect(markWebhookEventProcessed).toHaveBeenCalledWith('event-1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('acknowledges a duplicate that was already processed', async () => {
    logAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: true,
      eventId: 'event-1',
      processed: true,
    });

    const res = makeResponse();
    await initializeEscrowHandler(makeRequest(), res);

    expect(getEscrowByContractId).not.toHaveBeenCalled();
    expect(createEscrow).not.toHaveBeenCalled();
    expect(linkEscrowToReservation).not.toHaveBeenCalled();
  });
});

describe('amountToStroops', () => {
  it('converts whole and fractional asset amounts to stroops', () => {
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
