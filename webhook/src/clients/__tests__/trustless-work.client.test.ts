'use strict'

import {
  fetchIndexerEscrows,
  sendTransactionViaHelper,
  updateIndexerFromTxHash,
  trustlessWorkRequest,
  getIndexerTimeoutMs,
  getSendTxTimeoutMs,
  getUpdateTimeoutMs,
} from '../trustless-work.client'
import { UpstreamError, UpstreamTimeoutError } from '../../utils/errors'
import { logger } from '../../middleware/logger'

jest.mock('../../middleware/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('Trustless Work Client - Issue #770', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    process.env.TRUSTLESSWORK_API_URL = 'https://dev.api.trustlesswork.com'
    process.env.TRUSTLESSWORK_API_KEY = 'secret-test-api-key'
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('Configuration & Timeout defaults', () => {
    it('uses configured timeout values from environment', () => {
      process.env.TRUSTLESSWORK_INDEXER_TIMEOUT_MS = '45000'
      process.env.TRUSTLESSWORK_SEND_TX_TIMEOUT_MS = '20000'
      process.env.TRUSTLESSWORK_UPDATE_TIMEOUT_MS = '18000'

      expect(getIndexerTimeoutMs()).toBe(45000)
      expect(getSendTxTimeoutMs()).toBe(20000)
      expect(getUpdateTimeoutMs()).toBe(18000)
    })

    it('falls back to default timeout values when unset', () => {
      delete process.env.TRUSTLESSWORK_INDEXER_TIMEOUT_MS
      delete process.env.TRUSTLESSWORK_SEND_TX_TIMEOUT_MS
      delete process.env.TRUSTLESSWORK_UPDATE_TIMEOUT_MS
      delete process.env.TRUSTLESSWORK_TIMEOUT_MS

      expect(getIndexerTimeoutMs()).toBe(30000)
      expect(getSendTxTimeoutMs()).toBe(15000)
      expect(getUpdateTimeoutMs()).toBe(15000)
    })
  })

  describe('Success paths', () => {
    it('fetches indexer escrows successfully and sends x-api-key header', async () => {
      const mockEscrows = [{ contractId: 'contract-1', title: 'Test Escrow' }]
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockEscrows),
      })

      const escrows = await fetchIndexerEscrows(['contract-1'])
      expect(escrows).toEqual(mockEscrows)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/helper/get-escrow-by-contract-ids?contractIds=contract-1&validateOnChain=true'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'x-api-key': 'secret-test-api-key',
          }),
        })
      )
      expect(logger.info).toHaveBeenCalledWith(
        'upstream.call.success',
        expect.objectContaining({
          upstream: 'trustless-work',
          status: 200,
        })
      )
    })

    it('submits transaction via helper successfully', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ txHash: 'b'.repeat(64) }),
      })

      const res = await sendTransactionViaHelper('signed-xdr-sample', 'testnet')
      expect(res.success).toBe(true)
      expect(res.txHash).toBe('b'.repeat(64))
      expect(global.fetch).toHaveBeenCalledWith(
        'https://dev.api.trustlesswork.com/helper/send-transaction',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ signedXdr: 'signed-xdr-sample', network: 'testnet' }),
        })
      )
    })

    it('updates indexer from txHash successfully', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      })

      const res = await updateIndexerFromTxHash('b'.repeat(64), 'testnet')
      expect(res.success).toBe(true)
    })
  })

  describe('Error handling, timeouts, and status mapping', () => {
    it('converts AbortError/TimeoutError into UpstreamTimeoutError (504)', async () => {
      const timeoutErr = new Error('The operation was aborted due to timeout')
      timeoutErr.name = 'TimeoutError'
      global.fetch = jest.fn().mockRejectedValueOnce(timeoutErr)

      await expect(
        trustlessWorkRequest('/test-path', { timeoutMs: 1000 })
      ).rejects.toThrow(UpstreamTimeoutError)

      expect(logger.warn).toHaveBeenCalledWith(
        'upstream.call.failure',
        expect.objectContaining({
          upstream: 'trustless-work',
          path: '/test-path',
        })
      )
    })

    it('converts 5xx responses into UpstreamError (502)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'Internal gateway failed',
      })

      await expect(
        trustlessWorkRequest('/test-path', { timeoutMs: 1000 })
      ).rejects.toThrow(UpstreamError)

      expect(logger.warn).toHaveBeenCalledWith(
        'upstream.call.error_response',
        expect.objectContaining({
          upstream: 'trustless-work',
          status: 503,
        })
      )
    })

    it('converts unparseable JSON into UpstreamError (502)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '<html><body>502 Bad Gateway</body></html>',
      })

      await expect(
        trustlessWorkRequest('/test-path', { timeoutMs: 1000 })
      ).rejects.toThrow(UpstreamError)

      expect(logger.warn).toHaveBeenCalledWith(
        'upstream.call.invalid_json',
        expect.objectContaining({
          upstream: 'trustless-work',
          status: 200,
        })
      )
    })

    it('never logs api keys in telemetry fields', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      })

      await fetchIndexerEscrows(['c1'])

      const infoCalls = (logger.info as jest.Mock).mock.calls
      for (const call of infoCalls) {
        const fields = JSON.stringify(call)
        expect(fields).not.toContain('secret-test-api-key')
      }
    })
  })
})
