/**
 * Jest setup: the webhook's database module requires a password in every
 * environment (no fallback credentials), so tests provide non-secret values
 * here. Individual tests override these via resolveDbConfig(env) directly.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'
process.env.POSTGRES_HOST = process.env.POSTGRES_HOST ?? 'localhost'
process.env.POSTGRES_PORT = process.env.POSTGRES_PORT ?? '5432'
process.env.POSTGRES_DB = process.env.POSTGRES_DB ?? 'postgres'
process.env.POSTGRES_USER = process.env.POSTGRES_USER ?? 'postgres'
process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD ?? 'test-password'

export {}
