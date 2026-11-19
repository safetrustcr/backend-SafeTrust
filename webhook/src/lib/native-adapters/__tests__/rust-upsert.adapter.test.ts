import {
  __resetBulkUpsertForTests,
  __setBulkUpsertForTests,
  bulkUpsertWithRust,
} from '../rust-upsert.adapter'

describe('Rust upsert adapter', () => {
  afterEach(() => __resetBulkUpsertForTests())

  it('dispatches bulk persistence through an injected addon', async () => {
    const bulkUpsertEscrows = jest.fn(async () => '{"rows_affected":1}')
    __setBulkUpsertForTests({ bulkUpsertEscrows })

    await expect(bulkUpsertWithRust('[]', 'postgresql://localhost/db')).resolves.toBe(
      '{"rows_affected":1}'
    )
    expect(bulkUpsertEscrows).toHaveBeenCalledWith(
      '[]',
      'postgresql://localhost/db'
    )
  })
})
