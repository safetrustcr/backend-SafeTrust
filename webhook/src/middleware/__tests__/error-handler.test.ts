import express, { NextFunction, Request, Response } from 'express'
import request from 'supertest'
import { bindRequestContext, requestId } from '../logger'
import { errorHandler, notFoundHandler } from '../error-handler'
import { ConflictError, ServiceUnavailableError, ValidationError } from '../../utils/errors'

function makeApp(throwing: () => unknown) {
  const app = express()
  app.use(requestId)
  app.use(express.json())
  app.use(bindRequestContext)
  app.post('/boom', async () => {
    throw throwing()
  })
  app.get('/streamed', (_req: Request, res: Response, next: NextFunction) => {
    res.status(200).write('partial')
    next(new Error('after headers'))
  })
  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}

describe('errorHandler', () => {
  let errorSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  const originalLogLevel = process.env.LOG_LEVEL

  const lines = (spy: jest.SpyInstance) =>
    spy.mock.calls.map((call) => String(call[0])).filter((l) => l.startsWith('{')).map((l) => JSON.parse(l))

  beforeEach(() => {
    // Log assertions need records written whatever the caller's LOG_LEVEL is.
    process.env.LOG_LEVEL = 'info'
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalLogLevel === undefined) delete process.env.LOG_LEVEL
    else process.env.LOG_LEVEL = originalLogLevel
  })

  it.each([
    [() => new ValidationError('amount must be positive'), 400, 'validation_error', 'amount must be positive'],
    [() => new ConflictError('escrow already funded'), 409, 'conflict', 'escrow already funded'],
    [() => new ServiceUnavailableError('native addon missing'), 503, 'service_unavailable', 'Service unavailable'],
  ])('maps thrown AppErrors to their status', async (make, status, code, message) => {
    const res = await request(makeApp(make)).post('/boom').send({})
    expect(res.status).toBe(status)
    expect(res.body).toEqual({ success: false, error: message, code, requestId: res.headers['x-request-id'] })
  })

  it('sanitizes an unclassified error and logs it with the request id', async () => {
    const internal = Object.assign(new Error('duplicate key value violates "users_email_key"'), {
      details: { constraint: 'users_email_key' },
    })
    const res = await request(makeApp(() => internal)).post('/boom').send({})

    expect(res.status).toBe(500)
    expect(res.body).toEqual({
      success: false,
      error: 'Internal server error',
      code: 'internal_error',
      requestId: res.headers['x-request-id'],
    })

    const logged = lines(errorSpy).find((line) => line.event === 'http.unhandled_error')
    expect(logged).toMatchObject({
      requestId: res.headers['x-request-id'],
      method: 'POST',
      path: '/boom',
      status: 500,
      error: { message: 'duplicate key value violates "users_email_key"', details: { constraint: 'users_email_key' } },
    })
  })

  it('logs client errors as warnings without the error object', async () => {
    await request(makeApp(() => new ValidationError('bad'))).post('/boom').send({})

    const rejected = lines(warnSpy).find((line) => line.event === 'http.request_rejected')
    expect(rejected).toMatchObject({ status: 400, code: 'validation_error' })
    expect(rejected).not.toHaveProperty('error')
    expect(lines(errorSpy).find((line) => line.event === 'http.unhandled_error')).toBeUndefined()
  })

  it('maps a body parse error to 400', async () => {
    const res = await request(makeApp(() => new Error('unused')))
      .post('/boom')
      .set('Content-Type', 'application/json')
      .send('{not json')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_json')
  })

  it('logs and delegates to Express once headers are sent', async () => {
    // Express ends the half-written response by closing the connection.
    await expect(request(makeApp(() => new Error('unused'))).get('/streamed')).rejects.toThrow()

    expect(lines(errorSpy).find((line) => line.event === 'http.error_after_headers_sent'))
      .toMatchObject({ path: '/streamed', error: { message: 'after headers' } })
  })
})
