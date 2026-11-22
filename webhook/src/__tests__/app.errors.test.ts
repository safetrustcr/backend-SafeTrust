/**
 * Error classification, correlation and CORS on the real Express app.
 */
import crypto from 'crypto'
import type { Application } from 'express'
import request from 'supertest'
import { fundEscrowTransactional } from '../services/escrow.service'

// Firebase token verification is not exercised here; its ESM-only `jose`
// dependency cannot be loaded by Jest's CommonJS runtime.
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }))

// Importing the whole app would load the real stellar-utils native addon (the
// wallet handlers require it at import time). Node caches native addons per
// process, outside Jest's module registry, so a real load here bypasses the
// mocks in later test files of the same worker (wallet-challenge.handler.test).
jest.mock('../../../crates/stellar-utils', () => ({
  validateStellarAddress: jest.fn(() => true),
  verifyStellarEd25519: jest.fn(() => false),
}), { virtual: true })

jest.mock('../services/escrow.service', () => ({
  ...jest.requireActual('../services/escrow.service'),
  fundEscrowTransactional: jest.fn(),
}))

jest.mock('../services/hotel-conversation-notify', () => ({
  notifyHotelEscrowConversation: jest.fn().mockResolvedValue(undefined),
}))

const mockedFund = fundEscrowTransactional as jest.MockedFunction<typeof fundEscrowTransactional>
const SECRET = 'test-trustlesswork-secret'
const ALLOWED_ORIGIN = 'http://localhost:3001'

// The app resolves its CORS policy when it is imported, so it is loaded only
// after this test pins the environment, whatever the developer's .env says.
// dotenv does not override variables that are already set.
const TEST_ENV: Record<string, string> = {
  CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
  TRUSTLESSWORK_WEBHOOK_SECRET: SECRET,
  LOG_LEVEL: 'info',
}
const originalEnv = Object.fromEntries(Object.keys(TEST_ENV).map((key) => [key, process.env[key]]))

let app: Application

function signed(rawBody: string, signedBytes: string = rawBody) {
  const timestamp = String(Date.now())
  const digest = crypto.createHmac('sha256', SECRET).update(`${timestamp}.${signedBytes}`).digest('hex')
  return request(app)
    .post('/api/escrows/fund')
    .set('Content-Type', 'application/json')
    .set('x-trustlesswork-timestamp', timestamp)
    .set('x-trustlesswork-signature', `sha256=${digest}`)
    .send(rawBody)
}

function logLines(spy: jest.SpyInstance): Record<string, unknown>[] {
  return spy.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
}

describe('app error classification', () => {
  let errorSpy: jest.SpyInstance

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
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns 400, not 500, for a malformed JSON body', async () => {
    const res = await request(app)
      .post('/api/escrows/fund')
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
      .post('/api/escrows/fund')
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

  describe('raw body capture for signed TrustlessWork callbacks', () => {
    // Deliberately not JSON.stringify output: spacing differs from a re-serialization.
    const body = '{ "contractId": "C-1",  "signer": "GSIGNER", "amount": 25 }'

    it('verifies the signature over the exact bytes sent', async () => {
      mockedFund.mockResolvedValue({ isDuplicate: false } as Awaited<ReturnType<typeof fundEscrowTransactional>>)
      const originalTenantId = process.env.PLATFORM_TENANT_ID
      const testTenantId = 'test-platform'
      process.env.PLATFORM_TENANT_ID = testTenantId

      try {
        const res = await signed(body)

      expect(res.status).toBe(200)
      expect(mockedFund).toHaveBeenCalledWith(
        'C-1',
        25,
        expect.objectContaining({ contractId: 'C-1' }),
          testTenantId
      )
      } finally {
        if (originalTenantId === undefined) delete process.env.PLATFORM_TENANT_ID
        else process.env.PLATFORM_TENANT_ID = originalTenantId
      }
    })

    it('rejects a signature computed over re-serialized JSON', async () => {
      const res = await signed(body, JSON.stringify(JSON.parse(body)))

      expect(res.status).toBe(401)
      expect(mockedFund).not.toHaveBeenCalled()
    })
  })

  it('answers an unexpected failure with a sanitized 500 and a correlated log', async () => {
    mockedFund.mockRejectedValue(
      Object.assign(new Error('relation "safetrust.trustless_work_escrows" does not exist'), {
        details: [{ message: 'hasura: field "secret_column" not found' }],
      })
    )

    const res = await signed('{"contractId":"C-1","signer":"GSIGNER","amount":25}')

    expect(res.status).toBe(500)
    expect(res.body).toEqual({
      success: false,
      error: 'Failed to update escrow status',
      requestId: res.headers['x-request-id'],
    })
    const text = JSON.stringify(res.body)
    expect(text).not.toMatch(/relation|secret_column|stack|details/)

    const failure = logLines(errorSpy).find((line) => line.event === 'escrow.fund.failed')
    expect(failure).toMatchObject({
      requestId: res.headers['x-request-id'],
      contractId: 'C-1',
      error: { message: 'relation "safetrust.trustless_work_escrows" does not exist' },
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
