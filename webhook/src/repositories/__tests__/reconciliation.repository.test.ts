jest.mock('../../services/db', () => ({ query: jest.fn() }))

import {
  fetchSorobanEscrowRows,
  fetchTenantIds,
  findStaleEscrows,
  upsertEscrows,
} from '../reconciliation.repository'

const db = require('../../services/db')

describe('reconciliation repository', () => {
  beforeEach(() => {
    db.query.mockReset()
  })

  it('persists an escrow and reports an updated row', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ contract_id: 'C1' }] })

    await expect(upsertEscrows([{ contractId: 'C1' }])).resolves.toEqual({
      updated: 1,
      unchanged: 0,
      skipped: 0,
    })
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it('allows a versioned upsert at the same ledger when status and balance match the lifecycle commit', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ contract_id: 'C1' }] })

    await expect(
      upsertEscrows([
        {
          contractId: 'C1',
          status: 'funded',
          amount: 100,
          balance: 100,
          ledgerSeq: '30',
        },
      ])
    ).resolves.toEqual({ updated: 1, unchanged: 0, skipped: 0 })

    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('EXCLUDED.ledger_seq > safetrust.trustless_work_escrows.ledger_seq')
    expect(sql).toContain(
      'EXCLUDED.ledger_seq = safetrust.trustless_work_escrows.ledger_seq'
    )
    expect(sql).toContain(
      'safetrust.trustless_work_escrows.status = EXCLUDED.status'
    )
    expect(sql).toContain(
      'safetrust.trustless_work_escrows.balance = EXCLUDED.balance'
    )
    expect(params).toContain('30')
  })

  it('lists distinct tenant ids that own escrow rows', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ tenant_id: 'hotel_industry' }, { tenant_id: 'safetrust' }],
    })

    await expect(fetchTenantIds()).resolves.toEqual([
      'hotel_industry',
      'safetrust',
    ])

    const [sql] = db.query.mock.calls[0]
    expect(sql).toContain('SELECT DISTINCT tenant_id')
    expect(sql).toContain('FROM safetrust.trustless_work_escrows')
  })

  it('fetches Soroban rows for a non-default tenant', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    await expect(fetchSorobanEscrowRows('hotel_industry')).resolves.toEqual([])

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE tenant_id = $1'),
      ['hotel_industry']
    )
  })

  it('finds stale escrows for a non-default tenant', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ contract_id: 'hotel_1' }] })

    await expect(findStaleEscrows(7, 'hotel_industry')).resolves.toEqual([
      'hotel_1',
    ])

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE tenant_id = $1'),
      ['hotel_industry', 7]
    )
  })
})
