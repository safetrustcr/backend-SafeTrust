import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveDbConfig } from '../db'

const baseEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  POSTGRES_HOST: 'db.internal',
  POSTGRES_PORT: '5432',
  POSTGRES_DB: 'safetrust',
  POSTGRES_USER: 'webhook',
  POSTGRES_PASSWORD: 'a-secret',
})

describe('resolveDbConfig', () => {
  it('throws when POSTGRES_PASSWORD is missing (no fallback password)', () => {
    const env = baseEnv()
    delete env.POSTGRES_PASSWORD
    expect(() => resolveDbConfig(env)).toThrow(/POSTGRES_PASSWORD is required/)
  })

  it('throws when POSTGRES_PASSWORD is empty', () => {
    const env = { ...baseEnv(), POSTGRES_PASSWORD: '' }
    expect(() => resolveDbConfig(env)).toThrow(/POSTGRES_PASSWORD is required/)
  })

  it('defaults to no TLS (disable) outside production', () => {
    const config = resolveDbConfig(baseEnv())
    expect(config.ssl).toBe(false)
  })

  it('defaults to TLS (require) in production', () => {
    const config = resolveDbConfig({ ...baseEnv(), NODE_ENV: 'production' })
    expect(config.ssl).toEqual({ rejectUnauthorized: false })
  })

  it('rejects an unknown SSL mode', () => {
    const env = { ...baseEnv(), POSTGRES_SSL_MODE: 'prefer' }
    expect(() => resolveDbConfig(env)).toThrow(/POSTGRES_SSL_MODE must be one of/)
  })

  it('refuses disable in production unless the host is allowlisted', () => {
    const env = { ...baseEnv(), NODE_ENV: 'production', POSTGRES_SSL_MODE: 'disable' }
    expect(() => resolveDbConfig(env)).toThrow(/refused in production/)
  })

  it('allows disable in production for an explicitly allowlisted private host', () => {
    const env = {
      ...baseEnv(),
      NODE_ENV: 'production',
      POSTGRES_SSL_MODE: 'disable',
      POSTGRES_SSL_ALLOW_DISABLE_HOSTS: 'db.internal, other.internal',
    }
    const config = resolveDbConfig(env)
    expect(config.ssl).toBe(false)
  })

  it('maps require to an unverified TLS connection', () => {
    const config = resolveDbConfig({ ...baseEnv(), POSTGRES_SSL_MODE: 'require' })
    expect(config.ssl).toEqual({ rejectUnauthorized: false })
  })

  it('requires a CA file for verify-full', () => {
    const env = { ...baseEnv(), POSTGRES_SSL_MODE: 'verify-full' }
    expect(() => resolveDbConfig(env)).toThrow(/requires POSTGRES_SSL_CA_FILE/)
  })

  it('verifies the server certificate in verify-full using the CA file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'safetrust-ca-'))
    const caFile = join(dir, 'ca.pem')
    writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n')
    try {
      const config = resolveDbConfig({
        ...baseEnv(),
        POSTGRES_SSL_MODE: 'verify-full',
        POSTGRES_SSL_CA_FILE: caFile,
      })
      expect(config.ssl).toEqual({
        rejectUnauthorized: true,
        ca: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('carries connection and query timeouts from the environment', () => {
    const config = resolveDbConfig({
      ...baseEnv(),
      DB_CONNECTION_TIMEOUT_MS: '1500',
      DB_QUERY_TIMEOUT_MS: '20000',
    })
    expect(config.connectionTimeoutMillis).toBe(1500)
    expect(config.query_timeout).toBe(20000)
  })
})
