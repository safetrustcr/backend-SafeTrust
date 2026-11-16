import express from 'express'
import cors from 'cors'
import request from 'supertest'
import { corsOptions, resolveCorsPolicy } from '../cors'

function appWith(env: NodeJS.ProcessEnv) {
  const app = express()
  app.use(cors(corsOptions(resolveCorsPolicy(env))))
  app.get('/ping', (_req, res) => {
    res.setHeader('X-Request-Id', 'req-12345678')
    res.json({ ok: true })
  })
  return app
}

async function allowOrigin(env: NodeJS.ProcessEnv, origin: string) {
  const res = await request(appWith(env)).get('/ping').set('Origin', origin)
  return res.headers['access-control-allow-origin']
}

describe('resolveCorsPolicy', () => {
  it('uses the configured allowlist, normalized and deduplicated', () => {
    expect(resolveCorsPolicy({
      CORS_ALLOWED_ORIGINS: 'https://app.example.com, https://app.example.com/ ,http://localhost:3001',
    })).toEqual({ kind: 'allowlist', origins: ['https://app.example.com', 'http://localhost:3001'] })
  })

  it('treats * as an explicit any-origin opt-in', () => {
    expect(resolveCorsPolicy({ CORS_ALLOWED_ORIGINS: '*' })).toEqual({ kind: 'any' })
  })

  it('fails closed in production when unset', () => {
    expect(resolveCorsPolicy({ NODE_ENV: 'production' })).toEqual({ kind: 'none' })
  })

  it('allows only local origins outside production when unset', () => {
    expect(resolveCorsPolicy({ NODE_ENV: 'development' })).toEqual({ kind: 'local-dev' })
    expect(resolveCorsPolicy({})).toEqual({ kind: 'local-dev' })
  })

  it.each(['app.example.com', 'https://app.example.com/path', 'not a url'])(
    'rejects a malformed entry: %s',
    (entry) => {
      expect(() => resolveCorsPolicy({ CORS_ALLOWED_ORIGINS: entry })).toThrow(/CORS_ALLOWED_ORIGINS/)
    }
  )
})

describe('CORS headers', () => {
  const allowlist = { NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://app.example.com' }

  it('allows a listed origin and exposes X-Request-Id', async () => {
    const res = await request(appWith(allowlist)).get('/ping').set('Origin', 'https://app.example.com')
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com')
    expect(res.headers['access-control-expose-headers']).toBe('X-Request-Id')
  })

  it('gives an unlisted origin no CORS header, without failing the request', async () => {
    const res = await request(appWith(allowlist)).get('/ping').set('Origin', 'https://evil.example')
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('allows no browser origin in production when unset', async () => {
    expect(await allowOrigin({ NODE_ENV: 'production' }, 'https://app.example.com')).toBeUndefined()
  })

  it('allows localhost and 127.0.0.1 on any port in development', async () => {
    const dev = { NODE_ENV: 'development' }
    expect(await allowOrigin(dev, 'http://localhost:3001')).toBe('http://localhost:3001')
    expect(await allowOrigin(dev, 'http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173')
    expect(await allowOrigin(dev, 'http://localhost.evil.example')).toBeUndefined()
    expect(await allowOrigin(dev, 'https://app.example.com')).toBeUndefined()
  })

  it('answers any origin only when * is configured', async () => {
    expect(await allowOrigin({ CORS_ALLOWED_ORIGINS: '*' }, 'https://anything.example')).toBe('*')
  })

  it('leaves server-to-server requests without Origin untouched', async () => {
    const res = await request(appWith(allowlist)).get('/ping')
    expect(res.status).toBe(200)
  })
})
