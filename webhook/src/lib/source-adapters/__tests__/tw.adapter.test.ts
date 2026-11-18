jest.mock('https', () => ({ request: jest.fn() }))

import { EventEmitter } from 'events'
import {
  __resetTrustlessWorkConfigWarningsForTests,
  buildIndexerUrl,
  DEFAULT_TRUSTLESSWORK_API_URL,
  fetchEscrowsByContractIds,
  getTrustlessWorkApiKey,
  getTrustlessWorkApiUrl,
} from '../tw.adapter'

const https = require('https')

const ENV_KEYS = [
  'TRUSTLESSWORK_API_URL',
  'TRUSTLESSWORK_API_KEY',
  'TRUSTLESS_WORK_API_URL',
  'TRUSTLESS_WORK_API_KEY',
] as const

function mockResponse(body: unknown, statusCode = 200) {
  const response = new EventEmitter() as EventEmitter & { statusCode: number; setEncoding: jest.Mock }
  response.statusCode = statusCode
  response.setEncoding = jest.fn()

  const request = new EventEmitter() as EventEmitter & { setTimeout: jest.Mock; end: jest.Mock }
  request.setTimeout = jest.fn()
  request.end = jest.fn(() => {
    process.nextTick(() => {
      response.emit('data', typeof body === 'string' ? body : JSON.stringify(body))
      response.emit('end')
    })
  })

  https.request.mockImplementation((_options: unknown, callback: (res: typeof response) => void) => {
    callback(response)
    return request
  })
}

function lastRequestOptions(): { path: string; hostname: string; headers: Record<string, string> } {
  return https.request.mock.calls.at(-1)[0]
}

describe('TrustlessWork source adapter', () => {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

  beforeEach(() => {
    jest.clearAllMocks()
    for (const key of ENV_KEYS) delete process.env[key]
    __resetTrustlessWorkConfigWarningsForTests()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
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
      process.env.TRUSTLESSWORK_API_KEY = 'tw-key'
      expect(getTrustlessWorkApiUrl()).toBe('https://api.trustlesswork.com')
      expect(getTrustlessWorkApiKey()).toBe('tw-key')
      expect(console.warn).not.toHaveBeenCalled()
    })

    it('still reads the legacy names, warning once per name', () => {
      process.env.TRUSTLESS_WORK_API_KEY = 'legacy-key'
      expect(getTrustlessWorkApiKey()).toBe('legacy-key')
      expect(getTrustlessWorkApiKey()).toBe('legacy-key')

      expect(console.warn).toHaveBeenCalledTimes(1)
      expect(JSON.parse((console.warn as jest.Mock).mock.calls[0][0])).toMatchObject({
        event: 'trustlesswork.legacy_env_name',
        legacyName: 'TRUSTLESS_WORK_API_KEY',
        name: 'TRUSTLESSWORK_API_KEY',
      })
    })

    it('prefers the current name when both are set', () => {
      process.env.TRUSTLESSWORK_API_KEY = 'current'
      process.env.TRUSTLESS_WORK_API_KEY = 'legacy'
      expect(getTrustlessWorkApiKey()).toBe('current')
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
      process.env.TRUSTLESSWORK_API_KEY = 'tw-key'
      mockResponse([{ contractId: 'C1' }])

      await fetchEscrowsByContractIds(['C1'])

      expect(lastRequestOptions().headers['x-api-key']).toBe('tw-key')
      expect(lastRequestOptions().path).toBe(
        '/helper/get-escrow-by-contract-ids?contractIds=C1&validateOnChain=true'
      )
    })

    it('omits x-api-key when no key is configured', async () => {
      mockResponse([{ contractId: 'C1' }])
      await fetchEscrowsByContractIds(['C1'])
      expect(lastRequestOptions().headers).not.toHaveProperty('x-api-key')
    })

    it('uses the configured base URL', async () => {
      process.env.TRUSTLESSWORK_API_URL = 'https://api.trustlesswork.com'
      mockResponse([])
      await fetchEscrowsByContractIds(['C1'])
      expect(lastRequestOptions().hostname).toBe('api.trustlesswork.com')
    })

    it('returns the raw records from either response shape', async () => {
      mockResponse({ escrows: [{ contractId: 'C1', flags: { released: true } }] })
      await expect(fetchEscrowsByContractIds(['C1'])).resolves.toEqual([
        { contractId: 'C1', flags: { released: true } },
      ])

      mockResponse([{ contractId: 'C2' }])
      await expect(fetchEscrowsByContractIds(['C2'])).resolves.toEqual([{ contractId: 'C2' }])
    })

    it('rejects an unexpected shape', async () => {
      mockResponse({ unexpected: true })
      await expect(fetchEscrowsByContractIds(['C1'])).rejects.toThrow('Unexpected TrustlessWork API response shape')
    })
  })
})
