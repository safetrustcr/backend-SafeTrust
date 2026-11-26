import express from 'express'
import request from 'supertest'

describe('rate limits', () => {
  const previousEnv = {
    apiWindow: process.env.API_RATE_LIMIT_WINDOW_MS,
    apiMax: process.env.API_RATE_LIMIT_MAX,
    authWindow: process.env.AUTH_RATE_LIMIT_WINDOW_MS,
    authMax: process.env.AUTH_RATE_LIMIT_MAX,
    authIpMax: process.env.AUTH_IP_RATE_LIMIT_MAX,
    publicWindow: process.env.PUBLIC_RATE_LIMIT_WINDOW_MS,
    publicMax: process.env.PUBLIC_RATE_LIMIT_MAX,
  }

  afterAll(() => {
    if (previousEnv.apiWindow === undefined) delete process.env.API_RATE_LIMIT_WINDOW_MS
    else process.env.API_RATE_LIMIT_WINDOW_MS = previousEnv.apiWindow
    if (previousEnv.apiMax === undefined) delete process.env.API_RATE_LIMIT_MAX
    else process.env.API_RATE_LIMIT_MAX = previousEnv.apiMax
    if (previousEnv.authWindow === undefined) delete process.env.AUTH_RATE_LIMIT_WINDOW_MS
    else process.env.AUTH_RATE_LIMIT_WINDOW_MS = previousEnv.authWindow
    if (previousEnv.authMax === undefined) delete process.env.AUTH_RATE_LIMIT_MAX
    else process.env.AUTH_RATE_LIMIT_MAX = previousEnv.authMax
    if (previousEnv.authIpMax === undefined) delete process.env.AUTH_IP_RATE_LIMIT_MAX
    else process.env.AUTH_IP_RATE_LIMIT_MAX = previousEnv.authIpMax
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
    process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000'
    process.env.AUTH_RATE_LIMIT_MAX = '1'
    process.env.AUTH_IP_RATE_LIMIT_MAX = '10'
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

  it('gives each authenticated user an independent auth quota behind a shared IP', async () => {
    const { authIpRateLimit, authRateLimit } = require('../rate-limit')
    const app = express()
    app.use(authIpRateLimit)
    app.use((req, _res, next) => {
      const uid = req.header('x-test-user') || 'user-a'
      req.context = { uid, tenantId: 'safetrust', roles: ['guest'] }
      next()
    })
    app.use(authRateLimit)
    app.get('/', (_req, res) => res.sendStatus(200))

    await request(app).get('/').set('x-test-user', 'user-a').expect(200)
    await request(app).get('/').set('x-test-user', 'user-b').expect(200)
    const userASecondRequest = await request(app).get('/').set('x-test-user', 'user-a')
    expect(userASecondRequest.status).toBe(429)
    expect(userASecondRequest.headers['retry-after']).toMatch(/^\d+$/)
  })

  it('rejects rate-limit windows above Node’s timer limit', () => {
    process.env.PUBLIC_RATE_LIMIT_WINDOW_MS = '2147483648'
    jest.resetModules()
    expect(() => require('../rate-limit')).toThrow(
      'PUBLIC_RATE_LIMIT_WINDOW_MS must not exceed 2147483647 milliseconds'
    )
  })
})
