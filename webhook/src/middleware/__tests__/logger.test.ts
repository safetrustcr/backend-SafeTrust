import express from 'express'
import request from 'supertest'
import { bindRequestContext, getRequestId, logger, requestId, serializeError } from '../logger'

function captureLines(): { lines: () => Record<string, unknown>[]; restore: () => void } {
  const spies = (['log', 'warn', 'error', 'debug'] as const).map((method) =>
    jest.spyOn(console, method).mockImplementation(() => undefined)
  )
  return {
    lines: () => spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.parse(String(call[0])))),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  }
}

describe('logger', () => {
  const originalLevel = process.env.LOG_LEVEL
  let capture: ReturnType<typeof captureLines>

  beforeEach(() => {
    delete process.env.LOG_LEVEL
    capture = captureLines()
  })

  afterEach(() => {
    capture.restore()
    process.env.LOG_LEVEL = originalLevel
  })

  it('writes one JSON object with time, level, event and fields', () => {
    logger.info('escrow.fund.succeeded', { contractId: 'C-1' })

    const [line] = capture.lines()
    expect(line).toMatchObject({ level: 'info', event: 'escrow.fund.succeeded', contractId: 'C-1' })
    expect(new Date(line.time as string).toString()).not.toBe('Invalid Date')
  })

  it('routes levels to the matching console method', () => {
    logger.error('a.failed')
    expect(console.error).toHaveBeenCalledTimes(1)
    logger.warn('a.slow')
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('serializes errors with name, message, code and stack', () => {
    const error = Object.assign(new Error('boom'), { code: '23505' })
    logger.error('db.failed', { error })

    expect(capture.lines()[0].error).toMatchObject({ name: 'Error', message: 'boom', code: '23505' })
    expect((capture.lines()[0].error as { stack: string }).stack).toContain('boom')
  })

  it('serializes non-Error values', () => {
    expect(serializeError('nope')).toEqual({ message: 'nope' })
  })

  it('drops fields below LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'warn'
    logger.info('ignored')
    logger.warn('kept')
    expect(capture.lines().map((line) => line.event)).toEqual(['kept'])
  })

  it('writes nothing with LOG_LEVEL=silent', () => {
    process.env.LOG_LEVEL = 'silent'
    logger.error('ignored')
    expect(capture.lines()).toEqual([])
  })

  it('survives unserializable fields', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    logger.info('odd.payload', { circular })
    expect(capture.lines()[0]).toMatchObject({ event: 'odd.payload', unserializable: true })
  })
})

describe('request correlation', () => {
  let capture: ReturnType<typeof captureLines>

  function makeApp() {
    const app = express()
    app.use(requestId)
    app.use(express.json())
    app.use(bindRequestContext)
    app.post('/work', async (_req, res) => {
      // Cross an async boundary, as a handler awaiting the database would.
      await new Promise((resolve) => setTimeout(resolve, 5))
      logger.info('work.done')
      res.json({ requestId: getRequestId() })
    })
    return app
  }

  beforeEach(() => {
    capture = captureLines()
  })

  afterEach(() => {
    capture.restore()
  })

  it('assigns an id, returns it in X-Request-Id, and tags handler logs with it', async () => {
    const res = await request(makeApp()).post('/work').send({ a: 1 })

    const id = res.headers['x-request-id']
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.body.requestId).toBe(id)
    const events = capture.lines()
    expect(events.find((line) => line.event === 'work.done')).toMatchObject({ requestId: id })
  })

  it('reuses a well-formed incoming X-Request-Id', async () => {
    const res = await request(makeApp()).post('/work').set('X-Request-Id', 'edge-abc123-xyz').send({})
    expect(res.headers['x-request-id']).toBe('edge-abc123-xyz')
  })

  it('replaces a malformed incoming X-Request-Id', async () => {
    const res = await request(makeApp()).post('/work').set('X-Request-Id', 'bad id <script>').send({})
    expect(res.headers['x-request-id']).not.toBe('bad id <script>')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('writes an http.request access log without the query string', async () => {
    const res = await request(makeApp()).post('/work?token=secret').send({})

    const access = capture.lines().find((line) => line.event === 'http.request')
    expect(access).toMatchObject({
      requestId: res.headers['x-request-id'],
      method: 'POST',
      path: '/work',
      status: 200,
    })
    expect(typeof access?.durationMs).toBe('number')
    expect(JSON.stringify(capture.lines())).not.toContain('secret')
  })

  it('keeps concurrent requests apart', async () => {
    const app = makeApp()
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post('/work').send({}))
    )
    for (const res of responses) {
      expect(res.body.requestId).toBe(res.headers['x-request-id'])
    }
    expect(new Set(responses.map((res) => res.body.requestId)).size).toBe(5)
  })
})
