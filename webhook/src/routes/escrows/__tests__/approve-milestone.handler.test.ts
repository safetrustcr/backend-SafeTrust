'use strict'

import { Request, Response } from 'express'
import { approveMilestoneHandler } from '../approve-milestone.handler'
import {
  hasuraRequest,
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
  getHasuraEndpoint,
} from '../../../services/hasura'
import type { ApproveMilestonePayload } from '@safetrust/types'

jest.mock('../../../services/hasura', () => ({
  getHasuraEndpoint: jest.requireActual('../../../services/hasura').getHasuraEndpoint,
  hasuraRequest: jest.fn(),
  logAndCheckWebhookEvent: jest.fn(),
  markWebhookEventProcessed: jest.fn(),
}))

const mockedHasuraRequest = hasuraRequest as jest.MockedFunction<typeof hasuraRequest>
const mockedLogAndCheck = logAndCheckWebhookEvent as jest.MockedFunction<
  typeof logAndCheckWebhookEvent
>
const mockedMarkProcessed = markWebhookEventProcessed as jest.MockedFunction<
  typeof markWebhookEventProcessed
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
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns 400 when required fields are missing', async () => {
    const req = makeRequest({ contractId: 'contract-1' })
    const res = makeResponse()

    await approveMilestoneHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Missing required fields: contractId, milestoneId, approver, flag',
    })
  })

  it('returns 400 when flag is not true', async () => {
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
      error: 'flag must be true to approve a milestone',
    })
  })

  it('uses milestone-specific idempotency keys', async () => {
    mockedHasuraRequest.mockResolvedValueOnce({
      trustless_work_escrows: [{ id: 'escrow-1' }],
    })
    mockedHasuraRequest.mockResolvedValueOnce({
      update_escrow_milestones: { affected_rows: 1 },
    })
    mockedHasuraRequest.mockResolvedValueOnce({
      update_trustless_work_escrows: { affected_rows: 1 },
    })
    mockedHasuraRequest.mockResolvedValueOnce({})

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

  it('updates Hasura and returns 200 when both updates succeed', async () => {
    mockedHasuraRequest.mockResolvedValueOnce({
      trustless_work_escrows: [{ id: 'escrow-1' }],
    })
    mockedHasuraRequest.mockResolvedValueOnce({
      update_escrow_milestones: { affected_rows: 1 },
    })
    mockedHasuraRequest.mockResolvedValueOnce({
      update_trustless_work_escrows: { affected_rows: 1 },
    })
    mockedHasuraRequest.mockResolvedValueOnce({})

    const req = makeRequest({
      contractId: 'contract-1',
      milestoneId: 'check_in',
      approver: 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
      flag: true,
    })
    const res = makeResponse()

    await approveMilestoneHandler(req, res)

    expect(mockedHasuraRequest).toHaveBeenCalledTimes(4)
    expect(mockedMarkProcessed).toHaveBeenCalledWith('event-1')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ received: true })
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

    expect(mockedHasuraRequest).not.toHaveBeenCalled()
    expect(mockedMarkProcessed).toHaveBeenCalledWith('event-duplicate')
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('returns 404 when the escrow is not found', async () => {
    mockedHasuraRequest.mockResolvedValueOnce({
      trustless_work_escrows: [],
    })

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
      error: 'Escrow not found',
    })
    expect(mockedMarkProcessed).not.toHaveBeenCalled()
  })

  it('returns 500 when Hasura responds with GraphQL errors during mutation', async () => {
    mockedHasuraRequest.mockResolvedValueOnce({
      trustless_work_escrows: [{ id: 'escrow-1' }],
    })

    const error = Object.assign(new Error('Hasura request failed'), {
      details: [{ message: 'permission denied' }],
    })
    mockedHasuraRequest.mockRejectedValueOnce(error)

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
