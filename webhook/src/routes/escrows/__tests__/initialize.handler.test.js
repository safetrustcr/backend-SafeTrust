'use strict';

jest.mock('../../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
  logAndCheckWebhookEvent: jest.fn(),
  markWebhookEventProcessed: jest.fn(),
}));

jest.mock('../../../lib/zk-verifier', () => ({
  verifyProofOfFunds: jest.fn(),
}));

const { initializeEscrowHandler } = require('../initialize.handler');
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
      zk_public_inputs: 'inputs-hex',
    });
    const res = makeResponse();
    await initializeEscrowHandler(req, res);

    expect(verifyProofOfFunds).toHaveBeenCalledWith('proof-hex', 'vk-hex', 'inputs-hex');
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
      zk_public_inputs: 'inputs-hex',
    }), res);

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
      zk_public_inputs: '',
    }), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(logAndCheckWebhookEvent).not.toHaveBeenCalled();
    expect(hasuraRequest).not.toHaveBeenCalled();
  });
});
