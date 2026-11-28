'use strict'

/**
 * Unit tests for the typed upstream errors and their mapping onto the
 * AppError / classifyError contract from #748.
 */

import { classifyError } from '../../utils/errors'
import { UpstreamError, UpstreamTimeoutError } from '../../utils/upstream-errors'

describe('UpstreamError', () => {
  it('maps to 502 with a sanitized message', () => {
    const error = new UpstreamError('trustless-work responded with status 503: boom', 'trustless-work', '/helper/send-transaction', 503)
    expect(error.statusCode).toBe(502)
    expect(error.code).toBe('upstream_error')

    const classified = classifyError(error)
    expect(classified.status).toBe(502)
    // The client must never see the upstream body.
    expect(classified.message).toBe('Bad gateway')
  })

  it('carries upstream, path and status for server-side logging', () => {
    const error = new UpstreamError('x', 'stellar-horizon', '/transactions/abc', 500)
    expect(error.upstream).toBe('stellar-horizon')
    expect(error.upstreamPath).toBe('/transactions/abc')
    expect(error.upstreamStatus).toBe(500)
  })
})

describe('UpstreamTimeoutError', () => {
  it('maps to 504 with a sanitized message', () => {
    const error = new UpstreamTimeoutError('stellar-horizon', '/transactions/abc', 10_000)
    expect(error.statusCode).toBe(504)
    expect(error.code).toBe('upstream_timeout')

    const classified = classifyError(error)
    expect(classified.status).toBe(504)
    expect(classified.message).toBe('Gateway timeout')
  })

  it('carries the configured timeout', () => {
    const error = new UpstreamTimeoutError('trustless-work', '/helper/send-transaction', 15_000)
    expect(error.timeoutMs).toBe(15_000)
    expect(error.message).toContain('15000')
  })
})

import { getHorizonBaseUrl } from '../stellar.client'

describe('client base-url selection', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
  })

  it('reads the Horizon base URL once from STELLAR_NETWORK', () => {
    process.env.STELLAR_NETWORK = 'mainnet'
    delete process.env.HORIZON_BASE_URL
    expect(getHorizonBaseUrl()).toBe('https://horizon.stellar.org')
    expect(getHorizonBaseUrl('testnet')).toBe('https://horizon-testnet.stellar.org')
  })

  it('prefers the HORIZON_BASE_URL override', () => {
    process.env.STELLAR_NETWORK = 'testnet'
    process.env.HORIZON_BASE_URL = 'https://my-horizon/'
    expect(getHorizonBaseUrl()).toBe('https://my-horizon')
  })
})
