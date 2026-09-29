'use strict'

import { Request, Response } from 'express'
import { approveMilestoneHandler } from '../approve-milestone.handler'
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
  getHasuraEndpoint,
} from '../../../services/hasura'
import {
  validateApproveMilestonePayload,
  lookupEscrowByContractId,
  approveMilestoneAndUpdateReservation,
  EscrowNotFoundError,
  MilestoneValidationError,
} from '../../../services/milestone.service'
import type { ApproveMilestonePayload } from '@safetrust/types'

jest.mock('../../../services/hasura', () => ({
  getHasuraEndpoint: jest.requireActual('../../../services/hasura').getHasuraEndpoint,
  hasuraRequest: jest.fn(),
  logAndCheckWebhookEvent: jest.fn(),
  markWebhookEventProcessed: jest.fn(),
}))

// milestone.service uses the native escrow-state-machine addon which is not
// compiled in the test environment.  Mock the entire service so handler tests
// remain focused on routing / HTTP logic only.
jest.mock('../../../services/milestone.service', () => {
  const actual = jest.requireActual('../../../services/milestone.service')
  return {
    ...actual,
    validateApproveMilestonePayload: jest.fn(),
    lookupEscrowByContractId: jest.fn(),
    approveMilestoneAndUpdateReservation: jest.fn(),
  }
})

const mockedLogAndCheck = logAndCheckWebhookEvent as jest.MockedFunction<
  typeof logAndCheckWebhookEvent
>
const mockedMarkProcessed = markWebhookEventProcessed as jest.MockedFunction<
  typeof markWebhookEventProcessed
>
const mockedValidate = validateApproveMilestonePayload as jest.MockedFunction<
  typeof validateApproveMilestonePayload
>
const mockedLookup = lookupEscrowByContractId as jest.MockedFunction<
  typeof lookupEscrowByContractId
>
const mockedApprove = approveMilestoneAndUpdateReservation as jest.MockedFunction<
  typeof approveMilestoneAndUpdateReservation
>

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

function makeRequest(body: Partial<ApproveMilestonePayload>): Request {
  return { body } as Request
}

describe('approveMilestoneHandler', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.HASURA_GRAPHQL_ADMIN_SECRET = 'test-secret'
    process.env.HASURA_GRAPHQL_ENDPOINT = 'http://graphql-engine-test:8080'
    mockedLogAndCheck.mockResolvedValue({ isDuplicate: false, eventId: 'event-1' })
    mockedMarkProcessed.mockResolvedValue(undefined)
    mockedValidate.mockReturnValue(undefined)
    mockedLookup.mockResolvedValue({ escrowId: 'escrow-1' })
    mockedApprove.mockResolvedValue(undefined)
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns 400 when required fields are missing', async () => {
    mockedValidate.mockImplementation(() => {
      throw new MilestoneValidationError(
        'Missing required fields: contractId, milestoneId, approver, flag'
      )
    })

    const req = makeRequest({ contractId: 'contract-1' })
    const res = makeResponse()

    await approveMilestoneHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Missing required fields: contractId, milestoneId, approver, flag',
    })
  })

  it('returns 400 when flag is not true', async () => {
    mockedValidate.mockImplementation(() => {
      throw new MilestoneValidationError('flag must be true to approve a milestone')
    })

    const req = makeRequest({
      contractId: 'contract-1',
      milestoneId: 'check_in',
      approver: 'GABC',
      flag: false,
    })
    const res = makeResponse()

    await approveMilestoneHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'flag must be true to approve a milestone',
    })
  })

  it('uses milestone-specific idempotency keys', async () => {
    const req = makeRequest({
      contractId: 'contract-1',
      milestoneId: 'check_in',
      approver: 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
      flag: true,
    })
    const res = makeResponse()

    await approveMilestoneHandler(req, res)

    expect(mockedLogAndCheck).toHaveBeenCalledWith(
      'contract-1',
      'milestone.approved:check_in',
      req.body
    )
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('calls service and returns 200 when both updates succeed', async () => {
    const req = makeRequest({
      contractId: 'contract-1',
      milestoneId: 'check_in',
      approver: 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
      flag: true,
    })
    const res = makeResponse()

    await approveMilestoneHandler(req, res)

    expect(mockedLookup).toHaveBeenCalledWith('contract-1')
    expect(mockedApprove).toHaveBeenCalledWith(
      'escrow-1',
      'check_in',
      'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z'
    )
    expect(mockedMarkProcessed).toHaveBeenCalledWith('event-1')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ success: true })
  })

  it('returns 200 without re-processing duplicate milestone approvals', async () => {
    mockedLogAndCheck.mockResolvedValueOnce({
      isDuplicate: true,
      eventId: 'event-duplicate',
    })

    const req = makeRequest({
      contractId: 'contract-1',
      milestoneId: 'check_in',
      approver: 'GABC',
      flag: true,
    })
    const res = makeResponse()

    await approveMilestoneHandler(req, res)

    expect(mockedLookup).not.toHaveBeenCalled()
    expect(mockedMarkProcessed).toHaveBeenCalledWith('event-duplicate')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      duplicate: true,
      eventId: 'event-duplicate',
    })
  })

  it('returns 404 when the escrow is not found', async () => {
    mockedLookup.mockRejectedValueOnce(new EscrowNotFoundError('Escrow not found'))

    const req = makeRequest({
      contractId: 'missing-contract',
      milestoneId: 'check_in',
      approver: 'GABC',
      flag: true,
    })
    const res = makeResponse()

    await approveMilestoneHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Escrow not found',
    })
    expect(mockedMarkProcessed).not.toHaveBeenCalled()
  })

  it('returns 500 when the service throws an unexpected error', async () => {
    const error = Object.assign(new Error('Hasura request failed'), {
      details: [{ message: 'permission denied' }],
    })
    mockedLookup.mockRejectedValueOnce(error)

    const req = makeRequest({
      contractId: 'contract-1',
      milestoneId: 'check_in',
      approver: 'GABC',
      flag: true,
    })
    const res = makeResponse()

    await approveMilestoneHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Failed to update milestone approval',
    })
    expect(mockedMarkProcessed).not.toHaveBeenCalled()
  })
})

describe('getHasuraEndpoint', () => {
  const originalEnv = { ...process.env }

  afterAll(() => {
    process.env = originalEnv
  })

  it('appends /v1/graphql when the env value is the base Hasura URL', () => {
    process.env.HASURA_GRAPHQL_ENDPOINT = 'http://localhost:8080'
    expect(getHasuraEndpoint()).toBe('http://localhost:8080/v1/graphql')
  })
})
