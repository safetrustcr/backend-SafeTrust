'use strict'

import {
  verifyStellarTransaction,
  getHorizonBaseUrl,
  getHorizonTimeoutMs,
  VALID_TX_HASH,
} from '../stellar.client'
import { UpstreamError, UpstreamTimeoutError } from '../../utils/errors'
import { logger } from '../../middleware/logger'

jest.mock('../../middleware/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('Stellar Horizon Client - Issue #770', () => {
  const originalEnv = process.env
  const VALID_HASH = 'c'.repeat(64)

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.STELLAR_HORIZON_URL
    delete process.env.STELLAR_HORIZON_TIMEOUT_MS
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('Horizon Base URL & Timeout resolution', () => {
    it('resolves testnet URL by default', () => {
      expect(getHorizonBaseUrl('testnet')).toBe('https://horizon-testnet.stellar.org')
    })

    it('resolves mainnet URL when specified', () => {
      expect(getHorizonBaseUrl('mainnet')).toBe('https://horizon.stellar.org')
    })

    it('allows explicit STELLAR_HORIZON_URL override', () => {
      process.env.STELLAR_HORIZON_URL = 'https://custom-horizon.example.com/'
      expect(getHorizonBaseUrl()).toBe('https://custom-horizon.example.com')
    })

    it('respects configurable timeout from environment', () => {
      process.env.STELLAR_HORIZON_TIMEOUT_MS = '25000'
      expect(getHorizonTimeoutMs()).toBe(25000)
    })

    it('falls back to 10s default timeout', () => {
      expect(getHorizonTimeoutMs()).toBe(10000)
    })
  })

  describe('Validation & Success flows', () => {
    it('validates 64-hex format before attempting request', async () => {
      global.fetch = jest.fn()
      const res = await verifyStellarTransaction('invalid-short', 'testnet')
      expect(res.verified).toBe(false)
      expect(res.error).toContain('64-character hex string')
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('successfully verifies confirmed transaction', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ successful: true, ledger: 123456 }),
      })

      const res = await verifyStellarTransaction(VALID_HASH, 'testnet')
      expect(res.verified).toBe(true)
      expect(res.ledger).toBe(123456)
      expect(res.networkMatch).toBe(true)
      expect(logger.info).toHaveBeenCalledWith(
        'upstream.call.success',
        expect.objectContaining({
          upstream: 'stellar-horizon',
          status: 200,
        })
      )
    })
  })

  describe('Error handling & Status mapping', () => {
    it('returns verified: false on 404 not found (pending or wrong network)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const res = await verifyStellarTransaction(VALID_HASH, 'mainnet')
      expect(res.verified).toBe(false)
      expect(res.error).toContain('Transaction not found on Stellar mainnet')
      expect(logger.info).toHaveBeenCalledWith(
        'upstream.call.not_found',
        expect.objectContaining({
          upstream: 'stellar-horizon',
          status: 404,
        })
      )
    })

    it('handles timeout by throwing UpstreamTimeoutError (504)', async () => {
      const timeoutErr = new Error('The operation was aborted due to timeout')
      timeoutErr.name = 'TimeoutError'
      global.fetch = jest.fn().mockRejectedValueOnce(timeoutErr)

      await expect(verifyStellarTransaction(VALID_HASH, 'testnet')).rejects.toThrow(
        UpstreamTimeoutError
      )
    })

    it('handles 5xx status by throwing UpstreamError (502)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Horizon cluster failure',
      })

      await expect(verifyStellarTransaction(VALID_HASH, 'testnet')).rejects.toThrow(UpstreamError)
    })

    it('handles invalid JSON by throwing UpstreamError (502)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'not-valid-json',
      })

      await expect(verifyStellarTransaction(VALID_HASH, 'testnet')).rejects.toThrow(UpstreamError)
    })
  })
})
