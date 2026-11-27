/**
 * Error classification, correlation and CORS on the real Express app.
 */
import type { Application } from 'express'
import request from 'supertest'

jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }))

jest.mock('../../../crates/stellar-utils', () => ({
  validateStellarAddress: jest.fn(() => true),
  verifyStellarEd25519: jest.fn(() => false),
}), { virtual: true })

jest.mock('../repositories/reconciliation.repository', () => ({
  ...jest.requireActual('../repositories/reconciliation.repository'),
  fetchEscrowContractIds: jest.fn(),
}))

import { fetchEscrowContractIds } from '../repositories/reconciliation.repository'
import { logger } from '../middleware/logger'

const mockedFetchContractIds = fetchEscrowContractIds as jest.MockedFunction<typeof fetchEscrowContractIds>
const RECONCILE_PATH = '/reconciliation/sync-escrows'
const ALLOWED_ORIGIN = 'http://localhost:3001'

const TEST_ENV: Record<string, string> = {
  CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
  LOG_LEVEL: 'info',
}
const originalEnv = Object.fromEntries(Object.keys(TEST_ENV).map((key) => [key, process.env[key]]))

let app: Application

describe('app error classification', () => {
  beforeAll(() => {
    Object.assign(process.env, TEST_ENV)
    app = require('../app').default
  })

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns 400, not 500, for a malformed JSON body', async () => {
    const res = await request(app)
      .post(RECONCILE_PATH)
      .set('Content-Type', 'application/json')
      .send('{"contractId": "C-1",')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      success: false,
      error: 'Request body is not valid JSON',
      code: 'invalid_json',
      requestId: res.headers['x-request-id'],
    })
  })

  it('returns 413 for a body over the parser limit', async () => {
    const res = await request(app)
      .post(RECONCILE_PATH)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(200_000) }))

    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({ success: false, code: 'payload_too_large' })
  })

  it('returns a JSON 404 for an unknown route', async () => {
    const res = await request(app).get('/definitely-not-a-route')
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ success: false, code: 'route_not_found' })
    expect(res.body.requestId).toBe(res.headers['x-request-id'])
  })

  it('returns X-Request-Id on every response', async () => {
    const res = await request(app).get('/health/live')
    expect(res.headers['x-request-id']).toBeTruthy()
  })

  it('answers an unexpected failure with a sanitized 500 and a correlated log', async () => {
    mockedFetchContractIds.mockRejectedValue(
      Object.assign(new Error('relation "safetrust.trustless_work_escrows" does not exist'), {
        details: [{ message: 'hasura: field "secret_column" not found' }],
      })
    )
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined)

    const res = await request(app).post(RECONCILE_PATH).send({})

    expect(res.status).toBe(500)
    expect(res.body).toEqual({
      success: false,
      error: 'Internal server error',
      code: 'internal_error',
      requestId: res.headers['x-request-id'],
    })
    const text = JSON.stringify(res.body)
    expect(text).not.toMatch(/relation|secret_column|stack|details/)

    const failure = errorSpy.mock.calls.find(([event]) => event === 'http.unhandled_error')
    expect(failure?.[1]).toMatchObject({
      error: expect.objectContaining({ message: 'relation "safetrust.trustless_work_escrows" does not exist' }),
    })
  })

  describe('CORS', () => {
    it('allows a configured origin and exposes X-Request-Id', async () => {
      const res = await request(app).get('/health/live').set('Origin', ALLOWED_ORIGIN)
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN)
      expect(res.headers['access-control-expose-headers']).toBe('X-Request-Id')
    })

    it('gives a foreign origin no CORS header', async () => {
      const res = await request(app).get('/health/live').set('Origin', 'https://evil.example')
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
    })
  })
})
