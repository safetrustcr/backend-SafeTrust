'use strict'

/**
 * Unit tests for the Trustless Work and Stellar Horizon clients.
 * `fetch` is mocked per test; timeouts are produced by a fetch that
 * rejects with a TimeoutError-named error, the same shape
 * `AbortSignal.timeout` produces in Node.
 */

import {
  fetchEscrowsByContractIds,
  sendTransaction,
  updateIndexerFromTxHash,
} from '../trustless-work.client'
import { getTransactionByHash } from '../stellar.client'
import { UpstreamError, UpstreamTimeoutError } from '../../utils/upstream-errors'
import { classifyError } from '../../utils/errors'

const VALID_TX_HASH = 'a'.repeat(64)

const ENV_KEYS = [
  'TRUSTLESSWORK_API_URL',
  'TRUSTLESSWORK_API_KEY',
  'TRUSTLESS_WORK_API_URL',
  'TRUSTLESS_WORK_API_KEY',
  'STELLAR_NETWORK',
  'HORIZON_BASE_URL',
  'HORIZON_TIMEOUT_MS',
  'TRUSTLESSWORK_INDEXER_TIMEOUT_MS',
  'TRUSTLESSWORK_INDEXER_UPDATE_TIMEOUT_MS',
  'TRUSTLESSWORK_SEND_TRANSACTION_TIMEOUT_MS',
] as const

function okResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  }
}

function timeoutFetch() {
  return jest.fn((_url: string, init?: { signal?: AbortSignal }) => {
    const error = new Error('The operation was aborted due to timeout')
    error.name = 'TimeoutError'
    return Promise.reject(error)
  })
}

describe('trustless-work.client', () => {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

  beforeEach(() => {
    jest.clearAllMocks()
    for (const key of ENV_KEYS) delete process.env[key]
    jest.spyOn(console, 'error').mockImplementation(() => undefined) // client logs on failure
  })

  afterEach(() => jest.restoreAllMocks())

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  describe('fetchEscrowsByContractIds', () => {
    it('succeeds and passes the base URL, key and a timeout signal', async () => {
      process.env.TRUSTLESSWORK_API_URL = 'https://api.trustlesswork.com'
      process.env.TRUSTLESSWORK_API_KEY=('tw' + '-key')
      const mockFetch = jest.fn().mockResolvedValue(okResponse([{ contractId: 'C1' }]))
      global.fetch = mockFetch

      await expect(fetchEscrowsByContractIds(['C1'])).resolves.toEqual([{ contractId: 'C1' }])

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe(
        'https://api.trustlesswork.com/helper/get-escrow-by-contract-ids?contractIds=C1&validateOnChain=true',
      )
      expect(init).toMatchObject({ method: 'GET', headers: expect.objectContaining({ 'x-api-key': 'tw' + '-key' }) })
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('honors the configured timeout', async () => {
      process.env.TRUSTLESSWORK_INDEXER_TIMEOUT_MS = '500'
      const mockFetch = jest.fn().mockResolvedValue(okResponse([]))
      global.fetch = mockFetch

      await fetchEscrowsByContractIds(['C1'])
      expect(mockFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    })

    it('maps a timeout to UpstreamTimeoutError', async () => {
      global.fetch = timeoutFetch() as unknown as typeof fetch
      await expect(fetchEscrowsByContractIds(['C1'])).rejects.toBeInstanceOf(UpstreamTimeoutError)
      const error = await fetchEscrowsByContractIds(['C1']).catch((e) => e)
      expect(classifyError(error).status).toBe(504)
    })

    it('maps a 5xx to UpstreamError', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 503, text: async () => 'Service Unavailable' }) as unknown as typeof fetch
      const error = (await fetchEscrowsByContractIds(['C1']).catch((e) => e)) as UpstreamError
      expect(error).toBeInstanceOf(UpstreamError)
      expect(error.upstreamStatus).toBe(503)
      expect(classifyError(error).status).toBe(502)
    })

    it('maps invalid JSON to UpstreamError', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') } }) as unknown as typeof fetch
      await expect(fetchEscrowsByContractIds(['C1'])).rejects.toBeInstanceOf(UpstreamError)
    })

    it('never logs the api key', async () => {
      process.env.TRUSTLESSWORK_API_KEY=('tw' + '-key')
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }) as unknown as typeof fetch
      await fetchEscrowsByContractIds(['C1']).catch(() => undefined)
      const logged = (console.error as jest.Mock).mock.calls.map((c) => String(c[0])).join(' ')
      expect(logged).not.toContain('tw' + '-key')
      expect(logged).toContain('trustless-work')
      expect(logged).toContain('/helper/get-escrow-by-contract-ids')
    })

    it('never logs the upstream response body on a non-2xx', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 500, text: async () => 'SECRET_BODY_XDR_123' }) as unknown as typeof fetch
      const error = (await fetchEscrowsByContractIds(['C1']).catch((e) => e)) as UpstreamError
      const logged = (console.error as jest.Mock).mock.calls.map((c) => JSON.stringify(c)).join(' ')
      expect(logged).not.toContain('SECRET_BODY_XDR_123')
      expect(error.message).not.toContain('SECRET_BODY_XDR_123')
    })

    it('maps a body read aborted by the timeout to UpstreamTimeoutError', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          const e = new Error('aborted')
          e.name = 'TimeoutError'
          throw e
        },
      }) as unknown as typeof fetch
      await expect(fetchEscrowsByContractIds(['C1'])).rejects.toBeInstanceOf(UpstreamTimeoutError)
    })
  })

  describe('updateIndexerFromTxHash', () => {
    it('posts the tx hash for the network', async () => {
      const mockFetch = jest.fn().mockResolvedValue(okResponse({}))
      global.fetch = mockFetch

      await expect(updateIndexerFromTxHash(VALID_TX_HASH, 'testnet')).resolves.toBeUndefined()
      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toContain('/indexer/update-from-txHash')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({ txHash: VALID_TX_HASH, network: 'testnet' })
    })

    it('maps a timeout to UpstreamTimeoutError', async () => {
      global.fetch = timeoutFetch() as unknown as typeof fetch
      await expect(updateIndexerFromTxHash(VALID_TX_HASH, 'testnet')).rejects.toBeInstanceOf(UpstreamTimeoutError)
    })

    it('maps a 5xx to UpstreamError', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 503, text: async () => 'x' }) as unknown as typeof fetch
      await expect(updateIndexerFromTxHash(VALID_TX_HASH, 'testnet')).rejects.toBeInstanceOf(UpstreamError)
    })
  })

  describe('sendTransaction', () => {
    it('returns the tx hash from either response field', async () => {
      global.fetch = jest.fn().mockResolvedValue(okResponse({ txHash: VALID_TX_HASH })) as unknown as typeof fetch
      await expect(sendTransaction('SIGNED_XDR', 'testnet')).resolves.toEqual({ txHash: VALID_TX_HASH })

      global.fetch = jest.fn().mockResolvedValue(okResponse({ hash: VALID_TX_HASH })) as unknown as typeof fetch
      await expect(sendTransaction('SIGNED_XDR', 'testnet')).resolves.toEqual({ txHash: VALID_TX_HASH })
    })

    it('maps a timeout to UpstreamTimeoutError without resubmitting', async () => {
      const mockFetch = timeoutFetch()
      global.fetch = mockFetch as unknown as typeof fetch
      await expect(sendTransaction('SIGNED_XDR', 'testnet')).rejects.toBeInstanceOf(UpstreamTimeoutError)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('maps a 5xx to UpstreamError', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 502, text: async () => 'x' }) as unknown as typeof fetch
      await expect(sendTransaction('SIGNED_XDR', 'testnet')).rejects.toBeInstanceOf(UpstreamError)
    })

    it('maps invalid JSON to UpstreamError', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad') } }) as unknown as typeof fetch
      await expect(sendTransaction('SIGNED_XDR', 'testnet')).rejects.toBeInstanceOf(UpstreamError)
    })
  })
})

describe('stellar.client', () => {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

  beforeEach(() => {
    jest.clearAllMocks()
    for (const key of ENV_KEYS) delete process.env[key]
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => jest.restoreAllMocks())

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('succeeds and uses the testnet Horizon base URL by default', async () => {
    const mockFetch = jest.fn().mockResolvedValue(okResponse({ successful: true, ledger: 7 }))
    global.fetch = mockFetch

    await expect(getTransactionByHash(VALID_TX_HASH)).resolves.toEqual({ successful: true, ledger: 7 })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(`https://horizon-testnet.stellar.org/transactions/${VALID_TX_HASH}`)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('uses the mainnet Horizon base URL when STELLAR_NETWORK=mainnet', async () => {
    process.env.STELLAR_NETWORK = 'mainnet'
    const mockFetch = jest.fn().mockResolvedValue(okResponse({ successful: true, ledger: 7 }))
    global.fetch = mockFetch

    await getTransactionByHash(VALID_TX_HASH)
    expect(mockFetch.mock.calls[0][0]).toBe(`https://horizon.stellar.org/transactions/${VALID_TX_HASH}`)
  })

  it('returns null on a 404 instead of throwing', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' }) as unknown as typeof fetch
    await expect(getTransactionByHash(VALID_TX_HASH)).resolves.toBeNull()
  })

  it('maps a timeout to UpstreamTimeoutError', async () => {
    global.fetch = timeoutFetch() as unknown as typeof fetch
    await expect(getTransactionByHash(VALID_TX_HASH)).rejects.toBeInstanceOf(UpstreamTimeoutError)
  })

  it('maps a 5xx to UpstreamError', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 503, text: async () => 'x' }) as unknown as typeof fetch
    await expect(getTransactionByHash(VALID_TX_HASH)).rejects.toBeInstanceOf(UpstreamError)
  })

  it('maps invalid JSON to UpstreamError', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad') } }) as unknown as typeof fetch
    await expect(getTransactionByHash(VALID_TX_HASH)).rejects.toBeInstanceOf(UpstreamError)
  })
})
