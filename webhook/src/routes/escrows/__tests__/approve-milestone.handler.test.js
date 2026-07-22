'use strict';

jest.mock('../../../services/hasura', () => ({
  getHasuraEndpoint: jest.requireActual('../../../services/hasura').getHasuraEndpoint,
  hasuraRequest: jest.fn(),
  logAndCheckWebhookEvent: jest.fn(),
  markWebhookEventProcessed: jest.fn(),
}));

const {
  approveMilestoneHandler,
  getHasuraEndpoint,
} = require('../approve-milestone.handler');
const {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} = require('../../../services/hasura');

function makeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('approveMilestoneHandler', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HASURA_GRAPHQL_ADMIN_SECRET = 'test-secret';
    process.env.HASURA_GRAPHQL_ENDPOINT = 'http://graphql-engine-test:8080';
    logAndCheckWebhookEvent.mockResolvedValue({ isDuplicate: false, eventId: 'event-1' });
    markWebhookEventProcessed.mockResolvedValue(undefined);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns 400 when required fields are missing', async () => {
    const req = { body: { contractId: 'contract-1' } };
    const res = makeResponse();

    await approveMilestoneHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Missing required fields: contractId, milestoneId, approver, flag',
    });
  });

  it('returns 400 when flag is not true', async () => {
    const req = {
      body: {
        contractId: 'contract-1',
        milestoneId: 'check_in',
        approver: 'GABC',
        flag: false,
      },
    };
    const res = makeResponse();

    await approveMilestoneHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'flag must be true to approve a milestone',
    });
  });

  it('uses milestone-specific idempotency keys', async () => {
    hasuraRequest.mockResolvedValueOnce({
      trustless_work_escrows: [{ id: 'escrow-1' }],
    });
    hasuraRequest.mockResolvedValueOnce({
      update_escrow_milestones: { affected_rows: 1 },
    });
    hasuraRequest.mockResolvedValueOnce({
      update_trustless_work_escrows: { affected_rows: 1 },
    });

    const req = {
      body: {
        contractId: 'contract-1',
        milestoneId: 'check_in',
        approver: 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
        flag: true,
      },
    };
    const res = makeResponse();

    await approveMilestoneHandler(req, res);

    expect(logAndCheckWebhookEvent).toHaveBeenCalledWith(
      'contract-1',
      'milestone.approved:check_in',
      req.body
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('updates Hasura and returns 200 when both updates succeed', async () => {
    hasuraRequest.mockResolvedValueOnce({
      trustless_work_escrows: [{ id: 'escrow-1' }],
    });
    hasuraRequest.mockResolvedValueOnce({
      update_escrow_milestones: { affected_rows: 1 },
    });
    hasuraRequest.mockResolvedValueOnce({
      update_trustless_work_escrows: { affected_rows: 1 },
    });

    const req = {
      body: {
        contractId: 'contract-1',
        milestoneId: 'check_in',
        approver: 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
        flag: true,
      },
    };
    const res = makeResponse();

    await approveMilestoneHandler(req, res);

    expect(hasuraRequest).toHaveBeenCalledTimes(3);
    expect(markWebhookEventProcessed).toHaveBeenCalledWith('event-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('returns 200 without re-processing duplicate milestone approvals', async () => {
    logAndCheckWebhookEvent.mockResolvedValueOnce({
      isDuplicate: true,
      eventId: 'event-duplicate',
    });

    const req = {
      body: {
        contractId: 'contract-1',
        milestoneId: 'check_in',
        approver: 'GABC',
        flag: true,
      },
    };
    const res = makeResponse();

    await approveMilestoneHandler(req, res);

    expect(hasuraRequest).not.toHaveBeenCalled();
    expect(markWebhookEventProcessed).toHaveBeenCalledWith('event-duplicate');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 when the escrow is not found', async () => {
    hasuraRequest.mockResolvedValueOnce({
      trustless_work_escrows: [],
    });

    const req = {
      body: {
        contractId: 'missing-contract',
        milestoneId: 'check_in',
        approver: 'GABC',
        flag: true,
      },
    };
    const res = makeResponse();

    await approveMilestoneHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Escrow or milestone not found',
    });
    expect(markWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it('returns 500 when Hasura responds with GraphQL errors during mutation', async () => {
    hasuraRequest.mockResolvedValueOnce({
      trustless_work_escrows: [{ id: 'escrow-1' }],
    });

    const error = new Error('Hasura request failed');
    error.details = [{ message: 'permission denied' }];
    hasuraRequest.mockRejectedValueOnce(error);

    const req = {
      body: {
        contractId: 'contract-1',
        milestoneId: 'check_in',
        approver: 'GABC',
        flag: true,
      },
    };
    const res = makeResponse();

    await approveMilestoneHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to update milestone approval',
    });
    expect(markWebhookEventProcessed).not.toHaveBeenCalled();
  });
});

describe('getHasuraEndpoint', () => {
  const originalEnv = { ...process.env };

  afterAll(() => {
    process.env = originalEnv;
  });

  it('appends /v1/graphql when the env value is the base Hasura URL', () => {
    process.env.HASURA_GRAPHQL_ENDPOINT = 'http://localhost:8080';
    expect(getHasuraEndpoint()).toBe('http://localhost:8080/v1/graphql');
  });
});
