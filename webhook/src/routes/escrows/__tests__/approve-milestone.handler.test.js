'use strict';

const {
  approveMilestoneHandler,
  getHasuraEndpoint,
} = require('../approve-milestone.handler');

function makeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function mockDedupFetch() {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: { trustless_work_webhook_events: [] },
    }),
  });
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: {
        insert_trustless_work_webhook_events_one: { id: 'event-1' },
      },
    }),
  });
}

function mockMarkProcessedFetch() {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: {
        update_trustless_work_webhook_events_by_pk: { id: 'event-1' },
      },
    }),
  });
}

describe('approveMilestoneHandler', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HASURA_GRAPHQL_ADMIN_SECRET = 'test-secret';
    process.env.HASURA_GRAPHQL_ENDPOINT = 'http://graphql-engine-test:8080';
    global.fetch = jest.fn();
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

  it('updates Hasura and returns 200 when both updates succeed', async () => {
    mockDedupFetch();

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          trustless_work_escrows: [{ id: 'escrow-1' }],
        },
      }),
    });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          update_escrow_milestones: {
            affected_rows: 1,
          },
        },
      }),
    });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          update_trustless_work_escrows: {
            affected_rows: 1,
          },
        },
      }),
    });

    mockMarkProcessedFetch();

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

    expect(global.fetch).toHaveBeenCalledTimes(6);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('returns 404 when the escrow is not found', async () => {
    mockDedupFetch();

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          trustless_work_escrows: [],
        },
      }),
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
  });

  it('returns 500 when Hasura responds with GraphQL errors during mutation', async () => {
    mockDedupFetch();

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          trustless_work_escrows: [{ id: 'escrow-1' }],
        },
      }),
    });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        errors: [{ message: 'permission denied' }],
      }),
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

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to update milestone approval',
    });
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
