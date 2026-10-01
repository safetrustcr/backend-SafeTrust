'use strict'

import { Request, Response } from 'express'
import { approveMilestoneHandler } from '../approve-milestone.handler'
import {
  approveMilestone,
  EscrowStateConflictError,
  EscrowNotFoundError,
  MilestoneNotFoundError,
} from '../../../services/milestone.service'
import { getHasuraEndpoint } from '../../../services/hasura'
import type { ApproveMilestonePayload } from '@safetrust/types'

jest.mock('../../../services/milestone.service', () => ({
  approveMilestone: jest.fn(),
  EscrowStateConflictError: class EscrowStateConflictError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'EscrowStateConflictError'
    }
  },
  EscrowNotFoundError: class EscrowNotFoundError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'EscrowNotFoundError'
    }
  },
  MilestoneNotFoundError: class MilestoneNotFoundError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'MilestoneNotFoundError'
    }
  },
}))

const mockedApproveMilestone =
  approveMilestone as jest.MockedFunction<typeof approveMilestone>

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
    process.env.HASURA_GRAPHQL_ENDPOINT =
      'http://graphql-engine-test:8080'

    mockedApproveMilestone.mockResolvedValue({
      isDuplicate: false,
      eventId: 'event-1',
    })
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
      success: false,
      error: 'Missing required fields: contractId, milestoneId, approver, flag',
    })
    expect(mockedApproveMilestone).not.toHaveBeenCalled()
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
      success: false,
      error: 'flag must be true to approve a milestone',
    })
    expect(mockedApproveMilestone).not.toHaveBeenCalled()
  })

  it('passes milestone-specific approval data to the service', async () => {
    const req = makeRequest({
      contractId: 'contract-1',
      milestoneId: 'check_in',
      approver: 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
      flag: true,
    })
    const res = makeResponse()

    await approveMilestoneHandler(req, res)

    expect(mockedApproveMilestone).toHaveBeenCalledWith(
      'contract-1',
      'check_in',
      'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
      req.body
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ success: true })
  })

  it('returns 200 when the service succeeds', async () => {
    const req = makeRequest({
      contractId: 'contract-1',
      milestoneId: 'check_in',
      approver: 'GABC',
      flag: true,
    })
    const res = makeResponse()

    await approveMilestoneHandler(req, res)

    expect(mockedApproveMilestone).toHaveBeenCalledTimes(1)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ success: true })
  })

  it('returns 200 without re-processing duplicate milestone approvals', async () => {
    mockedApproveMilestone.mockResolvedValueOnce({
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

    expect(mockedApproveMilestone).toHaveBeenCalledTimes(1)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      duplicate: true,
      eventId: 'event-duplicate',
    })
  })

  it('returns 409 when the escrow is in an invalid prior state', async () => {
    mockedApproveMilestone.mockRejectedValueOnce(
      new EscrowStateConflictError(
        'Escrow is not in a valid state for milestone approval'
      )
    )

    const req = makeRequest({
      contractId: 'contract-1',
      milestoneId: 'check_in',
      approver: 'GABC',
      flag: true,
    })
    const res = makeResponse()

    await approveMilestoneHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Escrow is not in a valid state for milestone approval',
    })
  })

  it('returns 404 when the escrow is not found', async () => {
    mockedApproveMilestone.mockRejectedValueOnce(
      new EscrowNotFoundError('Escrow not found')
    )

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
  })

  it('returns 404 when the milestone is not found', async () => {
    mockedApproveMilestone.mockRejectedValueOnce(
      new MilestoneNotFoundError('Milestone not found')
    )

    const req = makeRequest({
      contractId: 'contract-1',
      milestoneId: 'check_in',
      approver: 'GABC',
      flag: true,
    })
    const res = makeResponse()

    await approveMilestoneHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Milestone not found',
    })
  })

  it('returns 500 for unexpected service errors', async () => {
    mockedApproveMilestone.mockRejectedValueOnce(
      new Error('Unexpected database failure')
    )

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
