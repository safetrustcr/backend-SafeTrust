'use strict'

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { NextFunction, Request, Response } from 'express'

declare global {
  namespace Express {
    interface Request {
      /** Correlation id for this request; also sent back as `X-Request-Id`. */
      requestId?: string
    }
  }
}

// ── Structured logger ──────────────────────────────────────────────────────────
//
// One JSON object per line: { time, level, event, requestId, ...fields }.
// `event` is a stable dotted name (`escrow.fund.failed`) to search and alert
// on; variable data goes in fields, never in the event name. Errors are
// serialized with name, message and stack. They are server-side only: the HTTP
// layer decides separately what a client may see.

type Level = 'debug' | 'info' | 'warn' | 'error'
export type LogFields = Record<string, unknown>

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const requestStore = new AsyncLocalStorage<{ requestId: string }>()

/** The current request's id, if this code runs inside a request. */
export function getRequestId(): string | undefined {
  return requestStore.getStore()?.requestId
}

function minimumLevel(): number {
  const configured = process.env.LOG_LEVEL?.trim().toLowerCase()
  if (configured === 'silent') return Number.POSITIVE_INFINITY
  return LEVELS[configured as Level] ?? LEVELS.info
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { message: String(error) }
  }
  const record = error as Error & { code?: unknown; statusCode?: unknown; details?: unknown }
  return {
    name: error.name,
    message: error.message,
    ...(record.code !== undefined ? { code: record.code } : {}),
    ...(record.statusCode !== undefined ? { statusCode: record.statusCode } : {}),
    ...(record.details !== undefined ? { details: record.details } : {}),
    ...(error.stack ? { stack: error.stack } : {}),
  }
}

function normalize(fields: LogFields): LogFields {
  const out: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      out[key] = value instanceof Error ? serializeError(value) : value
    }
  }
  return out
}

function write(level: Level, event: string, fields: LogFields = {}): void {
  if (LEVELS[level] < minimumLevel()) return

  const requestId = (fields.requestId as string | undefined) ?? getRequestId()
  let line: string
  try {
    line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      event,
      ...(requestId ? { requestId } : {}),
      ...normalize(fields),
    })
  } catch {
    line = JSON.stringify({ time: new Date().toISOString(), level, event, requestId, unserializable: true })
  }

  // Through console so the output keeps flowing to stdout/stderr unchanged.
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else if (level === 'debug') console.debug(line)
  else console.log(line)
}

export const logger = {
  debug: (event: string, fields?: LogFields) => write('debug', event, fields),
  info:  (event: string, fields?: LogFields) => write('info', event, fields),
  warn:  (event: string, fields?: LogFields) => write('warn', event, fields),
  error: (event: string, fields?: LogFields) => write('error', event, fields),
}

// ── Request correlation ────────────────────────────────────────────────────────

const INCOMING_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/

/** Path without the query string, which may carry tokens. */
export function requestPath(req: Request): string {
  return (req.originalUrl || req.url || '').split('?')[0]
}

/**
 * Assigns the request id (reusing a well-formed incoming `X-Request-Id`),
 * returns it in the response header, and writes exactly one `http.request`
 * access log line per request: on `finish`, or on `close` when the connection
 * ends before the response was fully sent (client disconnect, socket error).
 * Mount first, before body parsing, so even a rejected body is correlated.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id')
  const id = incoming && INCOMING_REQUEST_ID.test(incoming) ? incoming : randomUUID()
  req.requestId = id
  res.setHeader('X-Request-Id', id)

  const startedAt = process.hrtime.bigint()
  let logged = false
  const logCompletion = (): void => {
    if (logged) return
    logged = true

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6
    // `close` without `finish`: the response never completed, so the status
    // is what the handler had set (or the default), not what the client got.
    const aborted = !res.writableFinished
    const fields = {
      requestId: id,
      method: req.method,
      path: requestPath(req),
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      ...(aborted ? { aborted: true } : {}),
    }
    if (res.statusCode >= 500) logger.error('http.request', fields)
    else if (res.statusCode >= 400 || aborted) logger.warn('http.request', fields)
    else logger.info('http.request', fields)
  }
  res.once('finish', logCompletion)
  res.once('close', logCompletion)

  next()
}

/**
 * Makes the request id available to `logger` everywhere downstream, including
 * services, without passing it through every call. Mount after body parsing:
 * the parser resumes on stream events, which would drop the async context.
 */
export function bindRequestContext(req: Request, _res: Response, next: NextFunction): void {
  const id = req.requestId ?? randomUUID()
  req.requestId = id
  requestStore.run({ requestId: id }, () => next())
}
