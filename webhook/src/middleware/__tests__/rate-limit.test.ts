import express from 'express'
import request from 'supertest'

describe('rate limits', () => {
  const previousEnv = {
    apiWindow: process.env.API_RATE_LIMIT_WINDOW_MS,
    apiMax: process.env.API_RATE_LIMIT_MAX,
    publicWindow: process.env.PUBLIC_RATE_LIMIT_WINDOW_MS,
    publicMax: process.env.PUBLIC_RATE_LIMIT_MAX,
  }

  afterAll(() => {
    if (previousEnv.apiWindow === undefined) delete process.env.API_RATE_LIMIT_WINDOW_MS
    else process.env.API_RATE_LIMIT_WINDOW_MS = previousEnv.apiWindow
    if (previousEnv.apiMax === undefined) delete process.env.API_RATE_LIMIT_MAX
    else process.env.API_RATE_LIMIT_MAX = previousEnv.apiMax
    if (previousEnv.publicWindow === undefined) delete process.env.PUBLIC_RATE_LIMIT_WINDOW_MS
    else process.env.PUBLIC_RATE_LIMIT_WINDOW_MS = previousEnv.publicWindow
    if (previousEnv.publicMax === undefined) delete process.env.PUBLIC_RATE_LIMIT_MAX
    else process.env.PUBLIC_RATE_LIMIT_MAX = previousEnv.publicMax
  })

  beforeEach(() => {
    process.env.API_RATE_LIMIT_WINDOW_MS = '60000'
    process.env.API_RATE_LIMIT_MAX = '1'
    process.env.PUBLIC_RATE_LIMIT_WINDOW_MS = '60000'
    process.env.PUBLIC_RATE_LIMIT_MAX = '1'
    jest.resetModules()
  })

  it('keys authenticated API limits by user and returns Retry-After on 429', async () => {
    const { apiRateLimit } = require('../rate-limit')
    const app = express()
    app.use((req, _res, next) => {
      req.context = {
        uid: req.header('x-test-user') || 'user-a',
        tenantId: 'safetrust',
        roles: ['guest'],
      }
      next()
    })
    app.use(apiRateLimit)
    app.get('/', (_req, res) => res.sendStatus(200))

    await request(app).get('/').set('x-test-user', 'user-a').expect(200)
    const limited = await request(app).get('/').set('x-test-user', 'user-a')
    expect(limited.status).toBe(429)
    expect(limited.headers['retry-after']).toMatch(/^\d+$/)
    await request(app).get('/').set('x-test-user', 'user-b').expect(200)
  })

  it('limits public traffic by IP and returns Retry-After on 429', async () => {
    const { publicRateLimit } = require('../rate-limit')
    const app = express().use(publicRateLimit).get('/', (_req, res) => res.sendStatus(200))

    await request(app).get('/').expect(200)
    const limited = await request(app).get('/')
    expect(limited.status).toBe(429)
    expect(limited.headers['retry-after']).toMatch(/^\d+$/)
  })
})
