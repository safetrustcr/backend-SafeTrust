'use strict';

jest.mock('../../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
  logAndCheckWebhookEvent: jest.fn(),
  markWebhookEventProcessed: jest.fn(),
}));

jest.mock('../../../lib/zk-verifier', () => ({
  verifyProofOfFunds: jest.fn(),
}));

const { initializeEscrowHandler, amountToStroops } = require('../initialize.handler');
const {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} = require('../../../services/hasura');
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
    verifyProofOfFunds.mockReturnValue(true);
    logAndCheckWebhookEvent.mockResolvedValue({
      isDuplicate: false,
      eventId: 'event-1',
    });
    hasuraRequest.mockResolvedValue({
      insert_trustless_work_escrows_one: {
        id: 'escrow-1',
        contractId: 'contract-1',
        status: 'created',
        createdAt: '2026-08-24T00:00:00Z',
      },
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
    expect(hasuraRequest).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects a partial proof bundle without side effects', async () => {
    const res = makeResponse();
    await initializeEscrowHandler(makeRequest({ zk_proof: 'proof-hex' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(verifyProofOfFunds).not.toHaveBeenCalled();
    expect(logAndCheckWebhookEvent).not.toHaveBeenCalled();
    expect(hasuraRequest).not.toHaveBeenCalled();
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
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid ZK proof of funds' });
    expect(logAndCheckWebhookEvent).not.toHaveBeenCalled();
    expect(hasuraRequest).not.toHaveBeenCalled();
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
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid ZK proof of funds' });
    expect(logAndCheckWebhookEvent).not.toHaveBeenCalled();
    expect(hasuraRequest).not.toHaveBeenCalled();
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
    expect(hasuraRequest).not.toHaveBeenCalled();
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
