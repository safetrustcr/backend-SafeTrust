'use strict'

import { getPlatformTenantId } from '../../src/config/tenant'
import type { EscrowRecord } from '../../src/lib/reconciliation.types'
import { withTransaction } from '../../src/services/db'
import {
  executeEscrowLifecycleTransition,
  type EscrowLifecycleParams,
} from '../../src/services/escrow.service'
import { notifyHotelEscrowConversation } from '../../src/services/hotel-conversation-notify'
import {
  fetchEscrowTransitionStates,
  upsertEscrows,
} from '../../src/repositories/reconciliation.repository'
import { mirrorReservationStatus } from '../../src/repositories/reservation.repository'
import { fetchEscrowsByContractIds } from '../../src/lib/source-adapters/tw.adapter'
import {
  applyReconciliationTransitions,
  detectReconciliationTransitions,
  syncEscrowsWithIndexer,
  type ReconciliationTransition,
} from '../../src/services/reconciliation.service'

jest.mock('../../src/services/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
  pool: { query: jest.fn(), connect: jest.fn() },
  withTransaction: jest.fn(),
}))

jest.mock('../../src/repositories/reservation.repository', () => ({
  mirrorReservationStatus: jest.fn(),
}))

jest.mock('../../src/repositories/reconciliation.repository', () => ({
  fetchEscrowTransitionStates: jest.fn(),
  upsertEscrows: jest.fn(),
}))

jest.mock('../../src/lib/source-adapters/tw.adapter', () => ({
  fetchEscrowsByContractIds: jest.fn(),
}))

jest.mock('../../src/services/escrow.service', () => ({
  executeEscrowLifecycleTransition: jest.fn(),
}))

jest.mock('../../src/services/hotel-conversation-notify', () => ({
  notifyHotelEscrowConversation: jest.fn(),
}))

const executeMock = executeEscrowLifecycleTransition as unknown as jest.Mock
const notifyMock = notifyHotelEscrowConversation as unknown as jest.Mock
const statesMock = fetchEscrowTransitionStates as unknown as jest.Mock
const upsertMock = upsertEscrows as unknown as jest.Mock
const adapterMock = fetchEscrowsByContractIds as unknown as jest.Mock
const mirrorMock = mirrorReservationStatus as unknown as jest.Mock
const txMock = withTransaction as unknown as jest.Mock

function escrow(contractId: string, status: string, amount = 100): EscrowRecord {
  return {
    contractId,
    status,
    amount,
    balance: amount,
    escrowType: 'hospitality',
    network: 'testnet',
  }
}

function transition(overrides: Partial<ReconciliationTransition> = {}): ReconciliationTransition {
  return {
    contractId: 'C-FUND',
    observedStatus: 'funded',
    eventType: 'escrow.funded',
    targetStatus: 'funded',
    reservationStatus: 'funded',
    amount: 100,
    notification: {
      eventType: 'escrow_funded',
      body: 'SafeTrust: Your deposit has been confirmed on the Stellar network. Your booking is secured.',
    },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  executeMock.mockResolvedValue({ isDuplicate: false, eventId: 'event-1' })
  notifyMock.mockResolvedValue(undefined)
  statesMock.mockResolvedValue([])
  upsertMock.mockResolvedValue({ updated: 0, unchanged: 0, skipped: 0 })
  adapterMock.mockResolvedValue([])
  mirrorMock.mockResolvedValue(undefined)
  txMock.mockReset()
})

describe('reconciliation lifecycle transition detection', () => {
  test('detects each authoritative TW state change with its lifecycle command', () => {
    expect(
      detectReconciliationTransitions([{ contract_id: 'C-FUND', status: 'created' }], [escrow('C-FUND', 'funded')])
    ).toEqual([
      expect.objectContaining({
        contractId: 'C-FUND',
        eventType: 'escrow.funded',
        targetStatus: 'funded',
        reservationStatus: 'funded',
        amount: 100,
      }),
    ])

    expect(
      detectReconciliationTransitions([{ contract_id: 'C-RELEASE', status: 'funded' }], [escrow('C-RELEASE', 'completed', 0)])
    ).toEqual([
      expect.objectContaining({
        eventType: 'funds.released',
        targetStatus: 'completed',
        reservationStatus: 'completed',
        amount: 0,
      }),
    ])

    expect(
      detectReconciliationTransitions([{ contract_id: 'C-DISPUTE', status: 'funded' }], [escrow('C-DISPUTE', 'disputed')])
    ).toEqual([
      expect.objectContaining({
        eventType: 'dispute.raised',
        targetStatus: 'disputed',
        reservationStatus: 'disputed',
      }),
    ])

    expect(
      detectReconciliationTransitions([{ contract_id: 'C-RESOLVE', status: 'disputed' }], [escrow('C-RESOLVE', 'resolved', 0)])
    ).toEqual([
      expect.objectContaining({
        eventType: 'dispute.resolved',
        targetStatus: 'resolved',
        reservationStatus: 'resolved',
        amount: 0,
      }),
    ])
  })

  test('builds every spec-covered lifecycle step when an observer skips intermediate states', () => {
    const transitions = detectReconciliationTransitions(
      [{ contract_id: 'C-SKIP', status: 'created' }],
      [{ ...escrow('C-SKIP', 'completed', 100), ledgerSeq: '42' }]
    )

    expect(transitions.map((item) => item.targetStatus)).toEqual(['funded', 'completed'])
    expect(transitions.map((item) => item.eventType)).toEqual(['escrow.funded', 'funds.released'])
    expect(transitions.map((item) => item.amount)).toEqual([100, 0])
    expect(transitions.every((item) => item.observedLedgerSeq === '42')).toBe(true)
  })

  test('is idempotent for unchanged, new and backwards observations', () => {
    expect(detectReconciliationTransitions([{ contract_id: 'C1', status: 'funded' }], [escrow('C1', 'funded')])).toEqual([])
    expect(detectReconciliationTransitions([], [escrow('C2', 'funded')])).toEqual([])
    expect(detectReconciliationTransitions([{ contract_id: 'C3', status: 'completed' }], [escrow('C3', 'funded')])).toEqual([])
  })

  test('skips unsupported observed statuses and missing contract ids', () => {
    const unsupported = escrow('C4', 'cancelled')
    expect(detectReconciliationTransitions([{ contract_id: 'C4', status: 'created' }], [unsupported])).toEqual([])

    const missingId = escrow('', 'funded')
    expect(detectReconciliationTransitions([{ contract_id: '', status: 'created' }], [missingId])).toEqual([])
  })

  test('builds a deterministic event identity payload for the same transition', () => {
    const local = [{ contract_id: 'C1', status: 'created' }]
    const observed = [escrow('C1', 'funded')]
    const first = detectReconciliationTransitions(local, observed)[0]
    const second = detectReconciliationTransitions(local, observed)[0]

    expect(first).toEqual(second)
    expect(first.notification?.eventType).toBe('escrow_funded')
  })
})

describe('reconciliation transition application', () => {
  test('applies a transition through the atomic lifecycle command', async () => {
    const result = await applyReconciliationTransitions([transition()], {
      executeTransition: executeMock,
      notify: notifyMock,
    })

    expect(result).toEqual({
      detected: 1,
      applied: 1,
      duplicates: 0,
      failed: 0,
      errors: [],
      failedContractIds: [],
    })
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'C-FUND',
        eventType: 'escrow.funded',
        targetStatus: 'funded',
        reservationStatus: 'funded',
        amount: 100,
        tenantId: 'safetrust',
        rawPayload: {
          contractId: 'C-FUND',
          status: 'funded',
          source: 'reconciliation',
        },
      })
    )
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: 'C-FUND', eventType: 'escrow_funded' })
    )
  })

  test('passes the selected tenant and observed ledger sequence to the lifecycle command', async () => {
    await applyReconciliationTransitions([transition({ observedLedgerSeq: '99' })], {
      executeTransition: executeMock,
      notify: notifyMock,
      tenantId: 'other-tenant',
    })

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'other-tenant',
        observedLedgerSeq: '99',
      })
    )
  })

  test('does not notify for duplicate or transitionless lifecycle results', async () => {
    executeMock.mockResolvedValueOnce({ isDuplicate: true, eventId: 'event-1' })
    const result = await applyReconciliationTransitions([transition()], {
      executeTransition: executeMock,
      notify: notifyMock,
    })

    expect(result).toEqual({
      detected: 1,
      applied: 0,
      duplicates: 1,
      failed: 0,
      errors: [],
      failedContractIds: [],
    })
    expect(notifyMock).not.toHaveBeenCalled()
  })

  test('dispatches notification only after the transition commits', async () => {
    let commit: () => void = () => undefined
    const pending = new Promise<{ isDuplicate: boolean; eventId: string }>((resolve) => {
      commit = () => resolve({ isDuplicate: false, eventId: 'event-2' })
    })
    executeMock.mockReturnValueOnce(pending)

    const applying = applyReconciliationTransitions([transition()], {
      executeTransition: executeMock,
      notify: notifyMock,
    })
    await Promise.resolve()
    expect(notifyMock).not.toHaveBeenCalled()

    commit()
    await applying
    expect(notifyMock).toHaveBeenCalledTimes(1)
  })

  test('does not wait for a slow notification to resolve', async () => {
    notifyMock.mockReturnValueOnce(new Promise<void>(() => undefined))
    const result = await applyReconciliationTransitions([transition()], {
      executeTransition: executeMock,
      notify: notifyMock,
    })
    expect(result.applied).toBe(1)
  })

  test('isolates one failed transition from the rest', async () => {
    executeMock
      .mockRejectedValueOnce(new Error('state conflict'))
      .mockResolvedValueOnce({ isDuplicate: false, eventId: 'event-3' })

    const onFailed = jest.fn()
    const result = await applyReconciliationTransitions(
      [transition({ contractId: 'C-BAD' }), transition({ contractId: 'C-OK' })],
      { executeTransition: executeMock, notify: notifyMock, onFailed }
    )

    expect(result).toEqual({
      detected: 2,
      applied: 1,
      duplicates: 0,
      failed: 1,
      errors: ['C-BAD: state conflict'],
      failedContractIds: ['C-BAD'],
    })
    expect(executeMock).toHaveBeenCalledTimes(2)
    expect(notifyMock).toHaveBeenCalledTimes(1)
    expect(onFailed).toHaveBeenCalledWith('C-BAD', expect.any(Error))
  })
})

describe('atomic lifecycle transaction used by reconciliation', () => {
  const realExecute = jest.requireActual<typeof import('../../src/services/escrow.service')>(
    '../../src/services/escrow.service'
  ).executeEscrowLifecycleTransition

  interface TxQuery {
    sql: string
    params?: unknown[]
  }

  function mockTransaction(
    options: { existingEventId?: string; mirrorError?: Error; ledgerSeq?: string } = {}
  ) {
    const queries: TxQuery[] = []
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params })
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 }
        if (sql.startsWith('SELECT id') && sql.includes('trustless_work_webhook_events')) {
          return {
            rows: options.existingEventId ? [{ id: options.existingEventId }] : [],
            rowCount: options.existingEventId ? 1 : 0,
          }
        }
        if (sql.startsWith('INSERT INTO safetrust.trustless_work_webhook_events')) {
          return { rows: [{ id: 'event-1' }], rowCount: 1 }
        }
        if (sql.includes('FROM safetrust.trustless_work_escrows')) {
          return {
            rows: [
              {
                id: 'escrow-1',
                status: 'created',
                balance: 0,
                ledger_seq: options.ledgerSeq ?? null,
              },
            ],
            rowCount: 1,
          }
        }
        if (sql.startsWith('UPDATE safetrust.trustless_work_escrows')) return { rows: [], rowCount: 1 }
        if (sql.startsWith('UPDATE safetrust.trustless_work_webhook_events')) return { rows: [], rowCount: 1 }
        throw new Error(`Unexpected query: ${sql}`)
      }),
    }

    txMock.mockImplementation(async (callback: (c: typeof client) => Promise<unknown>) => callback(client))
    if (options.mirrorError) mirrorMock.mockRejectedValueOnce(options.mirrorError)
    return { client, queries }
  }

  const params: EscrowLifecycleParams = {
    contractId: 'C-ATOMIC',
    eventType: 'escrow.funded',
    targetStatus: 'funded',
    reservationStatus: 'funded',
    rawPayload: { contractId: 'C-ATOMIC', status: 'funded', source: 'reconciliation' },
    amount: 100,
  }

  test('locks the escrow and mirrors the reservation in the same transaction before commit', async () => {
    const { client, queries } = mockTransaction()
    const result = await realExecute(params)

    expect(result).toEqual({ isDuplicate: false, eventId: 'event-1', escrowId: 'escrow-1' })
    expect(queries[0].sql).toContain('pg_advisory_xact_lock')
    expect(queries.some((entry) => entry.sql.includes('FOR UPDATE'))).toBe(true)
    expect(queries.some((entry) => entry.sql.includes('SET status = $1') && entry.sql.includes('trustless_work_escrows'))).toBe(true)

    const mirrorOrder = mirrorMock.mock.invocationCallOrder[0]
    const processedOrder = client.query.mock.invocationCallOrder.find((_, index) =>
      queries[index]?.sql.startsWith('UPDATE safetrust.trustless_work_webhook_events')
    )
    expect(mirrorOrder).toBeLessThan(processedOrder ?? Number.MAX_SAFE_INTEGER)
  })

  test('returns a duplicate without replaying side effects when the event is processed', async () => {
    const { queries } = mockTransaction({ existingEventId: 'event-existing' })
    const result = await realExecute(params)

    expect(result).toEqual({ isDuplicate: true, eventId: 'event-existing' })
    expect(queries.some((entry) => entry.sql.startsWith('INSERT INTO'))).toBe(false)
    expect(mirrorMock).not.toHaveBeenCalled()
  })

  test('rolls back the escrow transition when the reservation mirror fails', async () => {
    const { queries } = mockTransaction({ mirrorError: new Error('reservation db down') })

    await expect(realExecute(params)).rejects.toThrow('reservation db down')
    expect(
      queries.some((entry) => entry.sql.startsWith('UPDATE safetrust.trustless_work_webhook_events'))
    ).toBe(false)
  })

  test('uses the explicitly selected tenant for event identity and reservation mirroring', async () => {
    const { queries } = mockTransaction()
    await realExecute({ ...params, tenantId: 'other-tenant' })

    const eventInsert = queries.find((entry) =>
      entry.sql.startsWith('INSERT INTO safetrust.trustless_work_webhook_events')
    )
    expect(eventInsert?.params?.[4]).toBe('other-tenant')
    expect(mirrorMock).toHaveBeenCalledWith('escrow-1', 'funded', 'other-tenant', expect.anything())
    expect(getPlatformTenantId()).toBeTruthy()
  })

  test('rejects an observation that is not newer than the locked escrow ledger', async () => {
    mockTransaction({ ledgerSeq: '20' })

    await expect(realExecute({ ...params, observedLedgerSeq: '20' })).rejects.toThrow(
      'not newer than stored ledger'
    )
    expect(mirrorMock).not.toHaveBeenCalled()
  })

  test('accepts a newer observation and reads ledger_seq inside the lifecycle transaction', async () => {
    const { queries } = mockTransaction({ ledgerSeq: '20' })

    await expect(realExecute({ ...params, observedLedgerSeq: '21' })).resolves.toEqual({
      isDuplicate: false,
      eventId: 'event-1',
      escrowId: 'escrow-1',
    })
    expect(queries.some((entry) => entry.sql.includes('ledger_seq::text AS ledger_seq'))).toBe(true)
    const escrowUpdate = queries.find((entry) =>
      entry.sql.startsWith('UPDATE safetrust.trustless_work_escrows')
    )
    expect(escrowUpdate?.sql).toContain('ledger_seq = $4')
    expect(escrowUpdate?.params).toContain('21')
    expect(mirrorMock).toHaveBeenCalledTimes(1)
  })
})

describe('reconciliation sync integration', () => {
  test('applies state changes before the raw upsert and reports them', async () => {
    const observed = [escrow('C-SYNC', 'funded')]
    adapterMock.mockResolvedValue(observed)
    statesMock.mockResolvedValue([{ contract_id: 'C-SYNC', id: 'escrow-1', status: 'created', balance: '0' }])
    upsertMock.mockResolvedValue({ updated: 1, unchanged: 0, skipped: 0 })

    const result = await syncEscrowsWithIndexer(['C-SYNC'], { applyTransitions: true })

    expect(result.transitions).toEqual({
      detected: 1,
      applied: 1,
      duplicates: 0,
      failed: 0,
      errors: [],
      failedContractIds: [],
    })
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: 'C-SYNC', eventType: 'escrow.funded' })
    )
    expect(upsertMock).toHaveBeenCalledWith([
      expect.objectContaining({ contractId: 'C-SYNC', status: 'funded', amount: 100 }),
    ])
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'escrow_funded' }))

    const executeOrder = executeMock.mock.invocationCallOrder[0]
    const upsertOrder = upsertMock.mock.invocationCallOrder[0]
    expect(executeOrder).toBeLessThan(upsertOrder)
  })

  test('applies skipped lifecycle states in order before the raw upsert', async () => {
    adapterMock.mockResolvedValue([
      { contractId: 'C-MULTI', amount: 100, balance: 100, flags: { released: true }, roles: {} },
    ])
    statesMock.mockResolvedValue([{ contract_id: 'C-MULTI', status: 'created' }])

    const result = await syncEscrowsWithIndexer(['C-MULTI'], { applyTransitions: true })

    expect(result.transitions?.applied).toBe(2)
    expect(executeMock.mock.calls.map((call) => call[0].targetStatus)).toEqual([
      'funded',
      'completed',
    ])
    expect(upsertMock).toHaveBeenCalledTimes(1)
  })

  test('does not advance raw status for escrows whose transition failed', async () => {
    const failed = escrow('C-FAILED', 'funded')
    const succeeded = escrow('C-SUCCEEDED', 'funded')
    adapterMock.mockResolvedValue([failed, succeeded])
    statesMock.mockResolvedValue([
      { contract_id: 'C-FAILED', status: 'created' },
      { contract_id: 'C-SUCCEEDED', status: 'created' },
    ])
    executeMock
      .mockRejectedValueOnce(new Error('mirror unavailable'))
      .mockResolvedValueOnce({ isDuplicate: false, eventId: 'event-ok' })
    upsertMock.mockResolvedValue({ updated: 1, unchanged: 0, skipped: 0 })

    const result = await syncEscrowsWithIndexer(['C-FAILED', 'C-SUCCEEDED'], {
      applyTransitions: true,
    })

    expect(result.transitions?.failed).toBe(1)
    expect(result.skipped).toBe(1)
    expect(upsertMock).toHaveBeenCalledWith([
      expect.objectContaining({ contractId: 'C-SUCCEEDED', status: 'funded' }),
    ])
    expect(upsertMock.mock.calls[0][0]).toHaveLength(1)
  })

  test('keeps a stale observation out of the lifecycle after a newer lifecycle commit with failed raw upsert', async () => {
    adapterMock.mockResolvedValueOnce([
      { contractId: 'C-LEDGER', amount: 100, balance: 100, ledgerSeq: '30', roles: {} },
    ])
    statesMock.mockResolvedValueOnce([{ contract_id: 'C-LEDGER', status: 'created' }])
    executeMock.mockResolvedValueOnce({ isDuplicate: false, eventId: 'event-a' })
    upsertMock.mockRejectedValueOnce(new Error('raw upsert failed'))

    await syncEscrowsWithIndexer(['C-LEDGER'], { applyTransitions: true })

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: 'C-LEDGER', observedLedgerSeq: '30' })
    )

    adapterMock.mockResolvedValueOnce([
      { contractId: 'C-LEDGER', amount: 50, balance: 50, ledgerSeq: '20', roles: {} },
    ])
    statesMock.mockResolvedValueOnce([
      { contract_id: 'C-LEDGER', status: 'funded', ledger_seq: '30' },
    ])
    upsertMock.mockResolvedValueOnce({ updated: 0, unchanged: 1, skipped: 0 })

    await syncEscrowsWithIndexer(['C-LEDGER'], { applyTransitions: true })

    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(upsertMock).toHaveBeenLastCalledWith([
      expect.objectContaining({ contractId: 'C-LEDGER', ledgerSeq: '20', balance: 50 }),
    ])
  })

  test('leaves legacy sync callers unchanged when transitions are not opted in', async () => {
    const observed = [escrow('C-LEGACY', 'funded')]
    adapterMock.mockResolvedValue(observed)
    statesMock.mockResolvedValue([{ contract_id: 'C-LEGACY', id: 'escrow-1', status: 'created', balance: '0' }])

    const result = await syncEscrowsWithIndexer(['C-LEGACY'])

    expect(result).not.toHaveProperty('transitions')
    expect(statesMock).not.toHaveBeenCalled()
    expect(executeMock).not.toHaveBeenCalled()
    expect(upsertMock).toHaveBeenCalledWith([
      expect.objectContaining({ contractId: 'C-LEGACY', status: 'funded', amount: 100 }),
    ])
  })
})
