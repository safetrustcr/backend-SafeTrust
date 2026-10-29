jest.mock('../../services/db', () => ({ query: jest.fn() }))

import { upsertEscrows } from '../reconciliation.repository'

const db = require('../../services/db')

describe('reconciliation repository', () => {
  it('persists an escrow and reports an updated row', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ contract_id: 'C1' }] })

    await expect(upsertEscrows([{ contractId: 'C1' }])).resolves.toEqual({
      updated: 1,
      unchanged: 0,
      skipped: 0,
    })
    expect(db.query).toHaveBeenCalledTimes(1)
  })
})
