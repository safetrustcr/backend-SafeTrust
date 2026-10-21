'use strict'

import { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  requestId?: string
  event?: string
  [contextKey: string]: unknown
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  requestId?: string
  event?: string
  message?: string
  error?: { name?: string; code?: string; statusCode?: number; message?: string; stack?: string }
  [key: string]: unknown
}

export interface Logger {
  debug: (message: string, context?: LogContext) => void
  info: (message: string, context?: LogContext) => void
  warn: (message: string, context?: LogContext) => void
  error: (message: string, context?: LogContext) => void
  child: (context: LogContext) => Logger
}

const serializeError = (err: unknown): LogEntry['error'] => {
  if (err instanceof Error) {
    const candidate = err as Error & { code?: string; statusCode?: number }
    return {
      name: err.name,
      code: candidate.code,
      statusCode: candidate.statusCode,
      message: err.message,
      stack: err.stack,
    }
  }
  if (err === undefined) {
    return undefined
  }
  return { message: typeof err === 'string' ? err : JSON.stringify(err) }
}

const write = (level: LogLevel, message: string, context: LogContext = {}): void => {
  const { error, event, requestId, ...rest } = context
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(requestId === undefined ? {} : { requestId }),
    ...(event === undefined ? {} : { event }),
    ...rest,
    ...(error === undefined ? {} : { error: serializeError(error) }),
  }
  const line = JSON.stringify(entry)
  if (level === 'error') {
    console.error(line)
    return
  }
  if (level === 'warn') {
    console.warn(line)
    return
  }
  console.log(line)
}

export const createLogger = (baseContext: LogContext = {}): Logger => ({
  debug: (message, context = {}) => write('debug', message, { ...baseContext, ...context }),
  info: (message, context = {}) => write('info', message, { ...baseContext, ...context }),
  warn: (message, context = {}) => write('warn', message, { ...baseContext, ...context }),
  error: (message, context = {}) => write('error', message, { ...baseContext, ...context }),
  child: (context) => createLogger({ ...baseContext, ...context }),
})

export const logger: Logger = createLogger()

export interface RequestWithContext extends Request {
  requestId?: string
  logger?: Logger
}

const readHeader = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

/**
 * Attaches a correlation id to every request and exposes a request-scoped
 * logger on `req.logger`. Honours an inbound `x-x-request-id` header when present
 * so clients/gateways can correlate across services.
 */
export const requestContextMiddleware = (
  req: RequestWithContext,
  res: Response,
  next: NextFunction
): void => {
  const incoming = readHeader(req.headers['x-request-id'])
  const requestId = incoming && incoming.length > 0 ? incoming : randomUUID()
  req.requestId = requestId
  req.logger = createLogger({ requestId })
  res.setHeader('x-request-id', requestId)
  next()
}

export default requestContextMiddleware
