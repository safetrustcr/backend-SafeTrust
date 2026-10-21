'use strict'

jest.mock('../../services/db', () => ({
  query: jest.fn(),
}))

jest.mock('../../repositories/hotel-conversation.repository', () => ({
  DEFAULT_CONVERSATION_DB_TIMEOUT_MS: 2_000,
  recordHotelConversationMessage:     jest.fn(),
}))

import { query } from '../db'
import {
  recordHotelConversationMessage,
} from '../../repositories/hotel-conversation.repository'
import {
  DEFAULT_NOTIFICATION_TIMEOUT_MS,
  notifyHotelEscrowConversation,
  sendHotelConversationMessage,
} from '../hotel-conversation-notify'

const mockedQuery = query as jest.MockedFunction<typeof query>
const mockedRecord = recordHotelConversationMessage as jest.MockedFunction<
  typeof recordHotelConversationMessage
>

const partiesRow = {
  reservation_id:        '11111111-1111-4111-8111-111111111111',
  escrow_transaction_id: '66666666-6666-4666-8666-666666666666',
  apartment_id:          '77777777-7777-4777-8777-777777777777',
  host_id:               '22222222-2222-4222-8222-222222222222',
  guest_id:              '33333333-3333-4333-8333-333333333333',
}

const conversation = {
  id:                    '44444444-4444-4444-8444-444444444444',
  reservation_id:        partiesRow.reservation_id,
  host_id:               partiesRow.host_id,
  guest_id:              partiesRow.guest_id,
  escrow_transaction_id: partiesRow.escrow_transaction_id,
  status:                'active',
}

const message = {
  id:              '55555555-5555-4555-8555-555555555555',
  conversation_id: conversation.id,
  sender_id:       partiesRow.guest_id,
  body:            'SafeTrust: Your deposit has been confirmed.',
  is_automated:    true,
  event_type:      'escrow_funded',
  created_at:      '2026-10-21T00:00:00.000Z',
}

const originalFetch = globalThis.fetch
const fetchMock = jest.fn()

describe('hotel-conversation-notify', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
    jest.useRealTimers()
  })

  it('writes through the shared service without any HTTP round-trip', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [partiesRow] } as never)
    mockedRecord.mockResolvedValueOnce({ conversation, message })

    const delivered = await notifyHotelEscrowConversation({
      contractId: 'contract-1',
      eventType:  'escrow_funded',
      body:       message.body,
      timeoutMs:  500,
    })

    expect(delivered).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockedRecord).toHaveBeenCalledTimes(1)

    const [params, budgetMs] = mockedRecord.mock.calls[0]
    expect(params).toEqual({
      reservationId:       partiesRow.reservation_id,
      hostId:              partiesRow.host_id,
      guestId:             partiesRow.guest_id,
      escrowTransactionId: partiesRow.escrow_transaction_id,
      senderId:            partiesRow.guest_id,
      body:                message.body,
      isAutomated:         true,
      eventType:           'escrow_funded',
    })
    expect(budgetMs).toBeGreaterThan(0)
    expect(budgetMs).toBeLessThanOrEqual(500)
  })

  it('skips cleanly when the contract is not a hotel escrow', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as never)

    const delivered = await notifyHotelEscrowConversation({
      contractId: 'contract-without-parties',
      eventType:  'escrow_funded',
      body:       'hello',
    })

    expect(delivered).toBe(false)
    expect(mockedRecord).not.toHaveBeenCalled()
  })

  it('swallows persistence failures so callers stay unaffected', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [partiesRow] } as never)
    mockedRecord.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(
      notifyHotelEscrowConversation({
        contractId: 'contract-1',
        eventType:  'escrow_completed',
        body:       'hello',
      })
    ).resolves.toBe(false)
  })

  it('returns within its explicit time budget when the write hangs', async () => {
    jest.useFakeTimers()
    mockedQuery.mockImplementationOnce(() => new Promise(() => undefined) as never)

    const pending = notifyHotelEscrowConversation({
      contractId: 'contract-1',
      eventType:  'escrow_funded',
      body:       'hello',
      timeoutMs:  50,
    })

    jest.advanceTimersByTime(50)

    await expect(pending).resolves.toBe(false)
    expect(mockedRecord).not.toHaveBeenCalled()
  })

  it('exposes the default budget to lifecycle callers', () => {
    expect(DEFAULT_NOTIFICATION_TIMEOUT_MS).toBe(2_000)
  })

  it('sendHotelConversationMessage forwards the caller budget to the repository', async () => {
    mockedRecord.mockResolvedValueOnce({ conversation, message })

    const result = await sendHotelConversationMessage({
      reservationId:       partiesRow.reservation_id,
      hostId:              partiesRow.host_id,
      guestId:             partiesRow.guest_id,
      escrowTransactionId: partiesRow.escrow_transaction_id,
      senderId:            partiesRow.guest_id,
      body:                message.body,
      isAutomated:         true,
      eventType:           'escrow_funded',
      timeoutMs:           750,
    })

    expect(result).toEqual(message)
    expect(mockedRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: partiesRow.reservation_id,
        hostId:        partiesRow.host_id,
        guestId:       partiesRow.guest_id,
      }),
      750
    )
  })
})
