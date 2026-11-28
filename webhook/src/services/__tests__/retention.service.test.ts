import { query } from '../db'
import { pruneOperationalData } from '../retention.service'

jest.mock('../db', () => ({ query: jest.fn() }))
jest.mock('../../middleware/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const mockedQuery = query as jest.MockedFunction<typeof query>
const ORIGINAL_ENV = process.env

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
  delete process.env.RETENTION_RETRY_DAYS
  delete process.env.RETENTION_PAYLOAD_DAYS
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('pruneOperationalData', () => {
  it('calls the retention function with the default periods', async () => {
    mockedQuery.mockResolvedValue({
      rows: [{ deleted_retries: '4', scrubbed_payloads: '7' }],
    } as never)

    const result = await pruneOperationalData()

    expect(mockedQuery).toHaveBeenCalledWith(
      'SELECT deleted_retries, scrubbed_payloads FROM safetrust.prune_operational_data($1, $2)',
      [30, 90]
    )
    expect(result).toEqual({
      retryDays: 30,
      payloadDays: 90,
      deletedRetries: 4,
      scrubbedPayloads: 7,
    })
  })

  it('reads the periods from the environment', async () => {
    process.env.RETENTION_RETRY_DAYS = '15'
    process.env.RETENTION_PAYLOAD_DAYS = '120'
    mockedQuery.mockResolvedValue({ rows: [{ deleted_retries: '0', scrubbed_payloads: '0' }] } as never)

    const result = await pruneOperationalData()

    expect(mockedQuery).toHaveBeenCalledWith(expect.any(String), [15, 120])
    expect(result).toEqual({
      retryDays: 15,
      payloadDays: 120,
      deletedRetries: 0,
      scrubbedPayloads: 0,
    })
  })

  it('rejects a non-positive configured period', async () => {
    process.env.RETENTION_RETRY_DAYS = '0'

    await expect(pruneOperationalData()).rejects.toThrow('RETENTION_RETRY_DAYS must be a positive integer')
    expect(mockedQuery).not.toHaveBeenCalled()
  })
})
