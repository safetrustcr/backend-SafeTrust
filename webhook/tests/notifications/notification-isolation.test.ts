'use strict'

/**
 * Notification-failure isolation for escrow lifecycle handlers.
 *
 * The real notifier runs here; only its I/O boundaries are mocked. A failing or
 * stalled conversation write must not change the committed escrow transition
 * or the HTTP status returned to TrustlessWork, and no notification may go
 * over HTTP to this server.
 */

import { Request, Response } from 'express'
import { fundEscrowHandler } from '../../src/routes/escrows/fund.handler'
import { releaseFundsHandler } from '../../src/routes/escrows/release-funds.handler'
import {
  fundEscrowTransactional,
  releaseFundsTransactional,
} from '../../src/services/escrow.service'
import {
  NOTIFICATION_TIMEOUT_MS,
  notifyHotelEscrowConversation,
} from '../../src/services/hotel-conversation-notify'
import { sendHotelConversationMessage } from '../../src/services/hotel-conversation.service'
import { query } from '../../src/services/db'

jest.mock('../../src/services/escrow.service', () => {
  class EscrowNotFoundError extends Error {}
  class EscrowStateConflictError extends Error {}
  return {
    fundEscrowTransactional: jest.fn(),
    releaseFundsTransactional: jest.fn(),
    EscrowNotFoundError,
    EscrowStateConflictError,
  }
})

jest.mock('../../src/services/db', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}))

jest.mock('../../src/services/hotel-conversation.service', () => ({
  sendHotelConversationMessage: jest.fn(),
}))

const mockedFund = fundEscrowTransactional as jest.MockedFunction<typeof fundEscrowTransactional>
const mockedRelease = releaseFundsTransactional as jest.MockedFunction<typeof releaseFundsTransactional>
const mockedSend = sendHotelConversationMessage as jest.MockedFunction<typeof sendHotelConversationMessage>
const mockedQuery = query as jest.MockedFunction<typeof query>

const PARTIES_ROW = {
  reservation_id: 'res-1',
  escrow_transaction_id: 'et-1',
  apartment_id: 'apt-1',
  host_id: 'host-1',
  guest_id: 'guest-1',
}

function makeResponse(): Response {
  const res: Partial<Response> = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res as Response
}

const lifecycleCases = [
  {
    name: 'fund',
    run: (res: Response) =>
      fundEscrowHandler(
        { body: { contractId: 'C-1', signer: 'G-SIGNER', amount: 100 } } as unknown as Request,
        res
      ),
    transition: () => mockedFund,
    eventType: 'escrow_funded',
  },
  {
    name: 'release-funds',
    run: (res: Response) =>
      releaseFundsHandler(
        { body: { contractId: 'C-1', releaseSigner: 'G-RELEASER' } } as unknown as Request,
        res
      ),
    transition: () => mockedRelease,
    eventType: 'escrow_completed',
  },
]

describe('lifecycle notification isolation', () => {
  const originalFetch = global.fetch
  const fetchSpy = jest.fn()

  beforeAll(() => {
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedFund.mockResolvedValue({ isDuplicate: false } as Awaited<ReturnType<typeof fundEscrowTransactional>>)
    mockedRelease.mockResolvedValue({ isDuplicate: false } as Awaited<ReturnType<typeof releaseFundsTransactional>>)
    mockedQuery.mockResolvedValue({ rows: [PARTIES_ROW] } as never)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  describe.each(lifecycleCases)('$name handler', ({ run, transition, eventType }) => {
    it('delivers through the shared service, not an HTTP call to itself', async () => {
      mockedSend.mockResolvedValue({ conversationId: 'conv-1', message: {} as never })
      const res = makeResponse()

      await run(res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(mockedSend).toHaveBeenCalledWith(expect.objectContaining({
        reservationId: 'res-1',
        hostId: 'host-1',
        guestId: 'guest-1',
        escrowTransactionId: 'et-1',
        isAutomated: true,
        eventType,
      }))
    })

    it('returns 200 with the transition committed when the conversation write fails', async () => {
      mockedSend.mockRejectedValue(new Error('hotel_industry.messages unavailable'))
      const res = makeResponse()

      await run(res)

      expect(transition()).toHaveBeenCalledTimes(1)
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({ success: true })
    })

    it('returns 200 when resolving the conversation parties fails', async () => {
      mockedQuery.mockRejectedValue(new Error('connection terminated'))
      const res = makeResponse()

      await run(res)

      expect(transition()).toHaveBeenCalledTimes(1)
      expect(mockedSend).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(200)
    })

    it('responds within the time budget when the conversation write stalls', async () => {
      jest.useFakeTimers()
      mockedSend.mockReturnValue(new Promise(() => undefined))
      const res = makeResponse()

      const pending = run(res)
      await jest.advanceTimersByTimeAsync(NOTIFICATION_TIMEOUT_MS)
      await pending

      expect(transition()).toHaveBeenCalledTimes(1)
      expect(res.status).toHaveBeenCalledWith(200)
    })
  })
})

describe('notifyHotelEscrowConversation', () => {
  const params = { contractId: 'C-1', eventType: 'escrow_funded', body: 'Deposit confirmed' }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('skips silently for contracts that are not hotel escrows', async () => {
    mockedQuery.mockResolvedValue({ rows: [] } as never)

    await expect(notifyHotelEscrowConversation(params)).resolves.toBeUndefined()
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('resolves after the budget instead of waiting on a stalled write', async () => {
    mockedQuery.mockResolvedValue({ rows: [PARTIES_ROW] } as never)
    mockedSend.mockReturnValue(new Promise(() => undefined))

    const started = Date.now()
    await expect(notifyHotelEscrowConversation(params, { timeoutMs: 25 })).resolves.toBeUndefined()

    expect(Date.now() - started).toBeLessThan(1_000)
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/exceeded 25ms time budget/))
  })

  it('does not leak an unhandled rejection when the write fails after the budget', async () => {
    mockedQuery.mockResolvedValue({ rows: [PARTIES_ROW] } as never)
    let rejectLate: (error: Error) => void = () => undefined
    mockedSend.mockReturnValue(new Promise((_resolve, reject) => { rejectLate = reject }))
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)

    try {
      await notifyHotelEscrowConversation(params, { timeoutMs: 5 })
      rejectLate(new Error('late failure'))
      await new Promise((resolve) => setImmediate(resolve))

      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
