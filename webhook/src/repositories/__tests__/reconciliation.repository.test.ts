jest.mock('../../services/db', () => ({ query: jest.fn() }))

import { upsertEscrows } from '../reconciliation.repository'

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
    expect(sql).toContain(
      'WHERE (\n    safetrust.trustless_work_escrows.tenant_id = EXCLUDED.tenant_id'
    )
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
})
