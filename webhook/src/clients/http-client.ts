'use strict'

/**
 * Shared HTTP boundary for every external call in the webhook.
 *
 * Each request carries a timeout from `AbortSignal.timeout(ms)` (configurable
 * per call site through the environment, see `.env.example`), and its
 * outcome is mapped onto a typed `UpstreamError` / `UpstreamTimeoutError`
 * from `utils/upstream-errors.ts` so a hung upstream becomes a 502/504
 * with a sanitized body instead of a generic 500.
 *
 * Every failure logs exactly one structured line via the app logger:
 * upstream, path, status and duration, and never the api key or the
 * request body (a signed XDR is a credential-like payload).
 *
 * Retry policy is the caller's job; see `utils/upstream-errors.ts`.
 */

import { logger } from '../middleware/logger'
import { UpstreamError, UpstreamTimeoutError } from '../utils/upstream-errors'

export interface UpstreamRequestOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
  /** Timeout for this call, in milliseconds. */
  timeoutMs: number
  /** Set false when the endpoint returns an empty or non-JSON body on success. */
  parseJson?: boolean
}

export interface UpstreamResult<T = unknown> {
  status: number
  /** Path of the URL that was called, without the query string. */
  path: string
  data: T
  durationMs: number
}

/** Read a positive-integer timeout from the environment, falling back to the default. */
export function readTimeoutMs(envName: string, defaultMs: number): number {
  const raw = process.env[envName]?.trim()
  if (!raw) return defaultMs
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : defaultMs
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  return record.name === 'TimeoutError' || record.name === 'AbortError' || record.code === 'ABORT_ERR'
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

/**
 * Perform one upstream request. 2xx responses are parsed as JSON and
 * returned. Timeouts, non-2xx responses, invalid JSON and transport
 * failures all throw a typed upstream error after logging one
 * structured line with the upstream name, path, status and duration.
 */
export async function upstreamRequest<T = unknown>(
  upstream: string,
  url: string,
  options: UpstreamRequestOptions,
): Promise<UpstreamResult<T>> {
  const path = pathOf(url)
  const startedAt = process.hrtime.bigint()
  const elapsed = () => Math.round((Number(process.hrtime.bigint() - startedAt) / 1e6) * 10) / 10

  const fail = (status: number | undefined, error: unknown): never => {
    logger.error('upstream.request_failed', {
      upstream,
      path,
      method: options.method ?? 'GET',
      status,
      durationMs: elapsed(),
      timeoutMs: options.timeoutMs,
      error: error instanceof Error ? error : new Error(String(error)),
    })
    if (isTimeoutError(error)) {
      throw new UpstreamTimeoutError(upstream, path, options.timeoutMs)
    }
    throw error instanceof UpstreamError
      ? error
      : new UpstreamError(
          error instanceof Error ? error.message : String(error),
          upstream,
          path,
          status,
        )
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch (error) {
    fail(undefined, error)
    throw error // unreachable, keeps TypeScript happy
  }

  if (!response.ok) {
    // Never copy the upstream body into the error: it is logged verbatim and
    // may echo credentials or signed XDR.
    fail(response.status, new Error(`${upstream} responded with status ${response.status}`))
  }

  if (options.parseJson === false) {
    return { status: response.status, path, data: undefined as T, durationMs: elapsed() }
  }

  try {
    const data = (await response.json()) as T
    return { status: response.status, path, data, durationMs: elapsed() }
  } catch (error) {
    // A stalled body aborted by the timeout must stay a timeout (504), not
    // an invalid-JSON 502.
    if (isTimeoutError(error)) {
      fail(response.status, error)
      throw error // unreachable
    }
    fail(response.status, new Error(`${upstream} returned invalid JSON: ${(error as Error).message}`))
    throw error // unreachable
  }
}
