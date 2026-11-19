import {
  __resetTrustlessWorkConfigWarningsForTests,
  buildIndexerUrl,
  DEFAULT_TRUSTLESSWORK_API_URL,
  fetchEscrowsByContractIds,
  getTrustlessWorkApiKey,
  getTrustlessWorkApiUrl,
} from '../tw.adapter'

const ENV_KEYS = [
  'TRUSTLESSWORK_API_URL',
  'TRUSTLESSWORK_API_KEY',
  'TRUSTLESS_WORK_API_URL',
  'TRUSTLESS_WORK_API_KEY',
  'TRUSTLESSWORK_INDEXER_TIMEOUT_MS',
] as const

function okResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

/**
 * The HTTP call now goes through the shared fetch client
 * (`clients/trustless-work.client.ts`), so the mock boundary is
 * global fetch rather than Node's https module.
 */
function mockFetchJson(body: unknown, status = 200) {
  const mockFetch = jest.fn().mockResolvedValue(okResponse(body, status))
  global.fetch = mockFetch as unknown as typeof fetch
  return mockFetch
}

function lastFetchCall(mockFetch: jest.Mock): [string, { headers: Record<string, string>; signal: AbortSignal }] {
  return mockFetch.mock.calls.at(-1) as unknown as [string, { headers: Record<string, string>; signal: AbortSignal }]
}

describe('TrustlessWork source adapter', () => {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

  beforeEach(() => {
    jest.clearAllMocks()
    for (const key of ENV_KEYS) delete process.env[key]
    __resetTrustlessWorkConfigWarningsForTests()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('configuration', () => {
    it('defaults to the Trustless Work testnet API with no key', () => {
      expect(getTrustlessWorkApiUrl()).toBe(DEFAULT_TRUSTLESSWORK_API_URL)
      expect(getTrustlessWorkApiKey()).toBe('')
    })

    it('reads the names docker-compose passes and drops a trailing slash', () => {
      process.env.TRUSTLESSWORK_API_URL = 'https://api.trustlesswork.com/'
      process.env.TRUSTLESSWORK_API_KEY=('tw' + '-key')
      expect(getTrustlessWorkApiUrl()).toBe('https://api.trustlesswork.com')
      expect(getTrustlessWorkApiKey()).toBe('tw' + '-key')
      expect(console.warn).not.toHaveBeenCalled()
    })

    it('still reads the legacy names, warning once per name', () => {
      process.env.TRUSTLESS_WORK_API_KEY=('legacy' + '-key')
      expect(getTrustlessWorkApiKey()).toBe('legacy' + '-key')
      expect(getTrustlessWorkApiKey()).toBe('legacy' + '-key')

      expect(console.warn).toHaveBeenCalledTimes(1)
      expect(JSON.parse((console.warn as jest.Mock).mock.calls[0][0])).toMatchObject({
        event: 'trustlesswork.legacy_env_name',
        legacyName: 'TRUSTLESS_WORK_API_KEY',
        name: 'TRUSTLESSWORK_API_KEY',
      })
    })

    it('prefers the current name when both are set', () => {
      process.env.TRUSTLESSWORK_API_KEY=('tw' + '-key')
      process.env.TRUSTLESS_WORK_API_KEY=('legacy' + '-key')
      expect(getTrustlessWorkApiKey()).toBe('tw' + '-key')
      expect(console.warn).not.toHaveBeenCalled()
    })
  })

  describe('buildIndexerUrl', () => {
    it('targets the V1 indexer path with one contractIds pair per id and validateOnChain', () => {
      const url = new URL(buildIndexerUrl('https://dev.api.trustlesswork.com', ['CA1', 'CB2']))
      expect(url.pathname).toBe('/helper/get-escrow-by-contract-ids')
      expect(url.searchParams.getAll('contractIds')).toEqual(['CA1', 'CB2'])
      expect(url.searchParams.get('validateOnChain')).toBe('true')
    })

    it('matches the documented single-id form', () => {
      expect(buildIndexerUrl('https://dev.api.trustlesswork.com', ['CA1'])).toBe(
        'https://dev.api.trustlesswork.com/helper/get-escrow-by-contract-ids?contractIds=CA1&validateOnChain=true'
      )
    })
  })

  describe('fetchEscrowsByContractIds', () => {
    it('sends the API key from TRUSTLESSWORK_API_KEY as x-api-key', async () => {
      process.env.TRUSTLESSWORK_API_KEY=('tw' + '-key')
      const mockFetch = mockFetchJson([{ contractId: 'C1' }])

      await fetchEscrowsByContractIds(['C1'])

      const [url, init] = lastFetchCall(mockFetch)
      expect(init.headers['x-api-key']).toBe('tw' + '-key')
      expect(url).toBe(
        'https://dev.api.trustlesswork.com/helper/get-escrow-by-contract-ids?contractIds=C1&validateOnChain=true'
      )
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('omits x-api-key when no key is configured', async () => {
      const mockFetch = mockFetchJson([{ contractId: 'C1' }])
      await fetchEscrowsByContractIds(['C1'])
      expect(lastFetchCall(mockFetch)[1].headers).not.toHaveProperty('x-api-key')
    })

    it('uses the configured base URL', async () => {
      process.env.TRUSTLESSWORK_API_URL = 'https://api.trustlesswork.com'
      const mockFetch = mockFetchJson([])
      await fetchEscrowsByContractIds(['C1'])
      expect(lastFetchCall(mockFetch)[0]).toContain('https://api.trustlesswork.com/helper/get-escrow-by-contract-ids')
    })

    it('returns the raw records from either response shape', async () => {
      mockFetchJson({ escrows: [{ contractId: 'C1', flags: { released: true } }] })
      await expect(fetchEscrowsByContractIds(['C1'])).resolves.toEqual([
        { contractId: 'C1', flags: { released: true } },
      ])

      mockFetchJson([{ contractId: 'C2' }])
      await expect(fetchEscrowsByContractIds(['C2'])).resolves.toEqual([{ contractId: 'C2' }])
    })

    it('rejects an unexpected shape', async () => {
      mockFetchJson({ unexpected: true })
      await expect(fetchEscrowsByContractIds(['C1'])).rejects.toThrow('Unexpected TrustlessWork API response shape')
    })

    it('maps a non-2xx response to a typed upstream error with the status', async () => {
      mockFetchJson('Not Found', 404)
      await expect(fetchEscrowsByContractIds(['C1'])).rejects.toThrow('404')
    })

    it('maps invalid JSON to a typed upstream error', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('Unexpected token') },
        text: async () => 'not-json!!',
      })
      global.fetch = mockFetch as unknown as typeof fetch
      await expect(fetchEscrowsByContractIds(['C1'])).rejects.toThrow('invalid JSON')
    })
  })
})
