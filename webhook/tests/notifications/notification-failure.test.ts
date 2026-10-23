'use strict'

import { Request, Response } from 'express'
import { PoolClient } from 'pg'
import type { TrustlessWorkEscrow } from '../../src/repositories/escrow.repository'

// Native escrow state machine is not available in the unit-test runtime.
jest.mock(
  '../../../crates/escrow-state-machine',
  () => ({
    getValidPriorStates: jest.fn(() => '["created","pending_funding"]'),
  }),
  { virtual: true }
)

jest.mock('../../src/repositories/webhook-event.repository', () => ({
  processWebhookEvent: jest.fn(),
}))

jest.mock('../../src/repositories/escrow.repository', () => ({
  fundEscrowInTransaction: jest.fn(),
  releaseFundsInTransaction: jest.fn(),
}))

jest.mock('../../src/repositories/reservation.repository', () => ({
  mirrorReservationStatusInTransaction: jest.fn(),
}))

jest.mock('../../src/services/hotel-conversation-notify', () => ({
  DEFAULT_NOTIFICATION_TIMEOUT_MS: 2_000,
  notifyHotelEscrowConversation: jest.fn(),
}))

import { fundEscrowHandler } from '../../src/routes/escrows/fund.handler'
import { releaseFundsHandler } from '../../src/routes/escrows/release-funds.handler'
import { processWebhookEvent } from '../../src/repositories/webhook-event.repository'
import {
  fundEscrowInTransaction,
  releaseFundsInTransaction,
} from '../../src/repositories/escrow.repository'
import { mirrorReservationStatusInTransaction } from '../../src/repositories/reservation.repository'
import {
  notifyHotelEscrowConversation,
} from '../../src/services/hotel-conversation-notify'

const mockedProcessWebhookEvent = processWebhookEvent as jest.Mock
const mockedFundEscrow = fundEscrowInTransaction as jest.Mock
const mockedReleaseFunds = releaseFundsInTransaction as jest.Mock
const mockedMirrorReservationStatus = mirrorReservationStatusInTransaction as jest.Mock
const mockedNotify = notifyHotelEscrowConversation as jest.Mock

function makeRequest(body: Record<string, unknown>): Request {
  return { body } as Request
}

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

/** Let a detached fire-and-forget promise settle before asserting. */
function flushNotificationDispatch(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('lifecycle notification failure isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockedProcessWebhookEvent.mockImplementation(
      async (...args: unknown[]) => {
        const process = args[3] as (
          client: PoolClient
        ) => Promise<TrustlessWorkEscrow | null>
        const result = await process({} as PoolClient)
        return { isDuplicate: false, eventId: 'event-1', result }
      }
    )

    mockedFundEscrow.mockResolvedValue({
      id: 'escrow-1',
      contractId: 'contract-1',
      status: 'funded',
    })
    mockedReleaseFunds.mockResolvedValue({
      id: 'escrow-1',
      contractId: 'contract-1',
      status: 'completed',
    })
    mockedMirrorReservationStatus.mockResolvedValue(undefined)
    mockedNotify.mockRejectedValue(new Error('conversation store unavailable'))
  })

  it('fund: a rejected notification leaves escrow state and the 200 response intact', async () => {
    const res = makeResponse()

    const response = await fundEscrowHandler(
      makeRequest({ contractId: 'contract-1', signer: 'GSIGNER', amount: 2500 }),
      res
    )

    await flushNotificationDispatch()

    expect(response).toBe(res)
    expect(mockedProcessWebhookEvent).toHaveBeenCalledTimes(1)
    expect(mockedFundEscrow).toHaveBeenCalledTimes(1)
    expect(mockedFundEscrow).toHaveBeenCalledWith(
      expect.anything(),
      'contract-1',
      2500,
      ['created', 'pending_funding']
    )
    expect(mockedMirrorReservationStatus).toHaveBeenCalledWith(
      expect.anything(),
      'escrow-1',
      'funded'
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ success: true })
    expect(res.status).not.toHaveBeenCalledWith(500)
  })

  it('release-funds: a rejected notification leaves escrow state and the 200 response intact', async () => {
    const res = makeResponse()

    const response = await releaseFundsHandler(
      makeRequest({ contractId: 'contract-1', releaseSigner: 'GRELEASER' }),
      res
    )

    await flushNotificationDispatch()

    expect(response).toBe(res)
    expect(mockedProcessWebhookEvent).toHaveBeenCalledTimes(1)
    expect(mockedReleaseFunds).toHaveBeenCalledTimes(1)
    expect(mockedMirrorReservationStatus).toHaveBeenCalledWith(
      expect.anything(),
      'escrow-1',
      'completed'
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ success: true })
    expect(res.status).not.toHaveBeenCalledWith(500)
  })

  it('fund: dispatches the notification with an explicit time budget', async () => {
    await fundEscrowHandler(
      makeRequest({ contractId: 'contract-1', signer: 'GSIGNER', amount: 2500 }),
      makeResponse()
    )

    await flushNotificationDispatch()

    expect(mockedNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'contract-1',
        eventType:  'escrow_funded',
        timeoutMs:  2_000,
      })
    )
  })

  it('release-funds: dispatches the notification with an explicit time budget', async () => {
    await releaseFundsHandler(
      makeRequest({ contractId: 'contract-1', releaseSigner: 'GRELEASER' }),
      makeResponse()
    )

    await flushNotificationDispatch()

    expect(mockedNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'contract-1',
        eventType:  'escrow_completed',
        timeoutMs:  2_000,
      })
    )
  })

  it('fund: does not wait for a pending notification before responding', async () => {
    mockedNotify.mockReturnValue(new Promise(() => undefined))

    const res = makeResponse()
    await fundEscrowHandler(
      makeRequest({ contractId: 'contract-1', signer: 'GSIGNER', amount: 2500 }),
      res
    )

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ success: true })
    expect(mockedProcessWebhookEvent).toHaveBeenCalledTimes(1)
  })
})
