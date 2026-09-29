'use strict';

jest.mock('../../../services/hasura', () => ({
  getHasuraEndpoint: jest.requireActual('../../../services/hasura').getHasuraEndpoint,
  hasuraRequest: jest.fn(),
  logAndCheckWebhookEvent: jest.fn(),
  markWebhookEventProcessed: jest.fn(),
}));

// milestone.service uses the native escrow-state-machine addon which is not
// compiled in the test environment.  Mock the entire service so handler tests
// remain focused on routing / HTTP logic only.
jest.mock('../../../services/milestone.service', () => {
  const { EscrowNotFoundError, MilestoneNotFoundError, MilestoneValidationError } =
    jest.requireActual('../../../services/milestone.service');
  return {
    EscrowNotFoundError,
    MilestoneNotFoundError,
    MilestoneValidationError,
    validateApproveMilestonePayload: jest.fn(),
    lookupEscrowByContractId: jest.fn(),
    approveMilestoneAndUpdateReservation: jest.fn(),
  };
});

const {
  approveMilestoneHandler,
} = require('../approve-milestone.handler');
const {
  getHasuraEndpoint,
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} = require('../../../services/hasura');
const {
  validateApproveMilestonePayload,
  lookupEscrowByContractId,
  approveMilestoneAndUpdateReservation,
  EscrowNotFoundError,
  MilestoneNotFoundError,
} = require('../../../services/milestone.service');

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
    validateApproveMilestonePayload.mockReturnValue(undefined);
    lookupEscrowByContractId.mockResolvedValue({ escrowId: 'escrow-1' });
    approveMilestoneAndUpdateReservation.mockResolvedValue(undefined);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns 400 when required fields are missing', async () => {
    validateApproveMilestonePayload.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { MilestoneValidationError } = require('../../../services/milestone.service');
      throw new MilestoneValidationError(
        'Missing required fields: contractId, milestoneId, approver, flag'
      );
    });

    const req = { body: { contractId: 'contract-1' } };
    const res = makeResponse();

    await approveMilestoneHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Missing required fields: contractId, milestoneId, approver, flag',
    });
  });

  it('returns 400 when flag is not true', async () => {
    validateApproveMilestonePayload.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { MilestoneValidationError } = require('../../../services/milestone.service');
      throw new MilestoneValidationError('flag must be true to approve a milestone');
    });

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
      success: false,
      error: 'flag must be true to approve a milestone',
    });
  });

  it('uses milestone-specific idempotency keys', async () => {
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

  it('calls service and returns 200 when both updates succeed', async () => {
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

    expect(lookupEscrowByContractId).toHaveBeenCalledWith('contract-1');
    expect(approveMilestoneAndUpdateReservation).toHaveBeenCalledWith(
      'escrow-1', 'check_in', 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z'
    );
    expect(markWebhookEventProcessed).toHaveBeenCalledWith('event-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
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

    expect(lookupEscrowByContractId).not.toHaveBeenCalled();
    expect(markWebhookEventProcessed).toHaveBeenCalledWith('event-duplicate');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      duplicate: true,
      eventId: 'event-duplicate',
    });
  });

  it('returns 404 when the escrow is not found', async () => {
    lookupEscrowByContractId.mockRejectedValueOnce(new EscrowNotFoundError('Escrow not found'));

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
      success: false,
      error: 'Escrow not found',
    });
    expect(markWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it('returns 500 when the service throws an unexpected error', async () => {
    const error = Object.assign(new Error('Hasura request failed'), {
      details: [{ message: 'permission denied' }],
    });
    lookupEscrowByContractId.mockRejectedValueOnce(error);

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
      success: false,
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
