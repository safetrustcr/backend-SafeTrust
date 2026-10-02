'use strict'

import { Request, Response } from 'express'
import { approveMilestoneHandler } from '../approve-milestone.handler'
import {
  logAndCheckWebhookEvent,
  markWebhookEventProcessed,
} from '../../../repositories/webhook-event.repository'
import {
  getEscrowByContractId,
  approveMilestone,
  approveEscrowStatus,
} from '../../../repositories/escrow.repository'
import {
  mirrorReservationStatus,
} from '../../../repositories/reservation.repository'
import type { ApproveMilestonePayload } from '@safetrust/types'

jest.mock('../../../repositories/webhook-event.repository', () => ({
  logAndCheckWebhookEvent: jest.fn(),
  markWebhookEventProcessed: jest.fn(),
}))

jest.mock('../../../repositories/escrow.repository', () => ({
  getEscrowByContractId: jest.fn(),
  approveMilestone: jest.fn(),
  approveEscrowStatus: jest.fn(),
}))

jest.mock('../../../repositories/reservation.repository', () => ({
  mirrorReservationStatus: jest.fn(),
}))

const mockedLogAndCheck = logAndCheckWebhookEvent as jest.MockedFunction<
  typeof logAndCheckWebhookEvent
>
const mockedMarkProcessed = markWebhookEventProcessed as jest.MockedFunction<
  typeof markWebhookEventProcessed
>
const mockedGetEscrow = getEscrowByContractId as jest.MockedFunction<
  typeof getEscrowByContractId
>
const mockedApproveMilestone = approveMilestone as jest.MockedFunction<
  typeof approveMilestone
>
const mockedApproveEscrowStatus = approveEscrowStatus as jest.MockedFunction<
  typeof approveEscrowStatus
>
const mockedMirrorReservationStatus = mirrorReservationStatus as jest.MockedFunction<
  typeof mirrorReservationStatus
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
      success: false,
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
      success: false,
      error: 'flag must be true to approve a milestone',
    })
  })

  it('uses milestone-specific idempotency keys', async () => {
    mockedGetEscrow.mockResolvedValueOnce({ id: 'escrow-1', contractId: 'contract-1', status: 'funded' })
    mockedApproveMilestone.mockResolvedValueOnce(true)
    mockedApproveEscrowStatus.mockResolvedValueOnce(true)
    mockedMirrorReservationStatus.mockResolvedValueOnce(undefined)

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

  it('updates repositories and returns 200 when both updates succeed', async () => {
    mockedGetEscrow.mockResolvedValueOnce({ id: 'escrow-1', contractId: 'contract-1', status: 'funded' })
    mockedApproveMilestone.mockResolvedValueOnce(true)
    mockedApproveEscrowStatus.mockResolvedValueOnce(true)
    mockedMirrorReservationStatus.mockResolvedValueOnce(undefined)

    const req = makeRequest({
      contractId: 'contract-1',
      milestoneId: 'check_in',
      approver: 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z',
      flag: true,
    })
    const res = makeResponse()

    await approveMilestoneHandler(req, res)

    expect(mockedGetEscrow).toHaveBeenCalledWith('contract-1')
    expect(mockedApproveMilestone).toHaveBeenCalledWith('escrow-1', 'check_in', 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z', expect.any(String))
    expect(mockedApproveEscrowStatus).toHaveBeenCalledWith('escrow-1', expect.any(String), expect.any(Array))
    expect(mockedMirrorReservationStatus).toHaveBeenCalledWith('escrow-1', 'checked_in')
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

    expect(mockedGetEscrow).not.toHaveBeenCalled()
    expect(mockedMarkProcessed).toHaveBeenCalledWith('event-duplicate')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      duplicate: true,
      eventId: 'event-duplicate',
    })
  })

  it('returns 404 when the escrow is not found', async () => {
    mockedGetEscrow.mockResolvedValueOnce(null)

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

  it('returns 500 when repository throws an error', async () => {
    mockedGetEscrow.mockRejectedValueOnce(new Error('DB failure'))

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
