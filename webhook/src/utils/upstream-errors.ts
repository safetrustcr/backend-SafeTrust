'use strict'

// ── Upstream (external HTTP) errors ──────────────────────────────────────────
//
// Every external call (Trustless Work, Stellar Horizon) goes through
// `clients/http-client.ts`, which maps transport failures onto these two
// AppError types and logs one structured line per failure (upstream, path,
// status, duration; never the api key). The global error handler already
// sanitizes 5xx bodies, so a hung upstream surfaces as 502/504 with a
// generic message instead of a 500 with provider detail.
//
// Retry policy (enforced by callers, not here):
//  - Safe to retry: 502/503/504 on idempotent GETs and on
//    `indexer/update-from-txHash` (re-indexing by txHash is a no-op when
//    the indexer already has the escrow).
//  - NOT blind-retried: a timeout on `helper/send-transaction` is
//    ambiguous, the transaction may have been submitted. Callers must
//    reconcile via the confirmation retry table
//    (`processPendingConfirmationRetries`) instead of resending the XDR.

import { AppError, type AppErrorOptions } from './errors'

/** The upstream answered 5xx, or the body was not valid JSON. -> 502. */
export class UpstreamError extends AppError {
  readonly upstream: string
  readonly upstreamStatus?: number
  readonly upstreamPath: string

  constructor(
    message: string,
    upstream: string,
    upstreamPath: string,
    upstreamStatus?: number,
    options: AppErrorOptions = {},
  ) {
    super(message, 502, { code: 'upstream_error', ...options })
    this.upstream = upstream
    this.upstreamPath = upstreamPath
    this.upstreamStatus = upstreamStatus
  }
}

/** The upstream request exceeded its configured timeout. -> 504. */
export class UpstreamTimeoutError extends AppError {
  readonly upstream: string
  readonly upstreamPath: string
  readonly timeoutMs: number

  constructor(upstream: string, upstreamPath: string, timeoutMs: number, options: AppErrorOptions = {}) {
    super(`${upstream} timed out after ${timeoutMs} ms at ${upstreamPath}`, 504, {
      code: 'upstream_timeout',
      ...options,
    })
    this.upstream = upstream
    this.upstreamPath = upstreamPath
    this.timeoutMs = timeoutMs
  }
}
