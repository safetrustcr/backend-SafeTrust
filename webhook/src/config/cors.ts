'use strict'

import { CorsOptions } from 'cors'

/**
 * CORS policy for browser clients.
 *
 * CORS only governs browsers. Server-to-server callers (TrustlessWork
 * callbacks, the Hasura cron trigger, x402 agents) send no `Origin` header and
 * are unaffected; their routes are protected by signatures and secrets.
 *
 * `CORS_ALLOWED_ORIGINS` is a comma-separated list of exact origins, for
 * example `https://app.safetrust.example,https://staging.safetrust.example`:
 *   - set:                       only those origins receive CORS headers
 *   - `*`:                       any origin (explicit opt-in; never the default)
 *   - unset, production:         no origin is allowed (fail closed)
 *   - unset, any other NODE_ENV: http(s)://localhost and 127.0.0.1 on any port
 *
 * A disallowed origin gets no `Access-Control-Allow-Origin` header, so the
 * browser blocks the response; the request itself is not turned into an error.
 */

const LOCAL_DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/

export type CorsPolicy =
  | { kind: 'allowlist'; origins: string[] }
  | { kind: 'any' }
  | { kind: 'local-dev' }
  | { kind: 'none' }

function parseOrigin(entry: string): string {
  let url: URL
  try {
    url = new URL(entry)
  } catch {
    throw new Error(`CORS_ALLOWED_ORIGINS entry is not a valid origin: "${entry}"`)
  }
  if (url.origin === 'null' || url.origin !== entry.replace(/\/$/, '')) {
    throw new Error(
      `CORS_ALLOWED_ORIGINS entry must be an origin (scheme://host[:port]) without a path: "${entry}"`
    )
  }
  return url.origin
}

export function resolveCorsPolicy(env: NodeJS.ProcessEnv = process.env): CorsPolicy {
  const raw = env.CORS_ALLOWED_ORIGINS?.trim()
  if (raw === '*') return { kind: 'any' }
  if (raw) {
    const origins = raw.split(',').map((entry) => entry.trim()).filter(Boolean).map(parseOrigin)
    return { kind: 'allowlist', origins: [...new Set(origins)] }
  }
  return env.NODE_ENV === 'production' ? { kind: 'none' } : { kind: 'local-dev' }
}

export function corsOptions(policy: CorsPolicy): CorsOptions {
  const shared: CorsOptions = { exposedHeaders: ['X-Request-Id'], maxAge: 600 }
  switch (policy.kind) {
    case 'any':       return { ...shared, origin: '*' }
    case 'allowlist': return { ...shared, origin: policy.origins }
    case 'local-dev': return { ...shared, origin: LOCAL_DEV_ORIGIN }
    case 'none':      return { ...shared, origin: false }
  }
}

export function describeCorsPolicy(policy: CorsPolicy): Record<string, unknown> {
  switch (policy.kind) {
    case 'allowlist': return { policy: 'allowlist', origins: policy.origins }
    case 'any':       return { policy: 'any-origin' }
    case 'local-dev': return { policy: 'local-dev', origins: ['http(s)://localhost:*', 'http(s)://127.0.0.1:*'] }
    case 'none':      return { policy: 'none' }
  }
}
