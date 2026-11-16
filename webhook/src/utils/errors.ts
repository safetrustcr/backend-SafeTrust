'use strict'

// ── AppError hierarchy ─────────────────────────────────────────────────────────
//
// Throw these from services and middleware; the global error handler maps them
// to HTTP responses. `expose` decides whether `message` may reach the client:
// it defaults to true for 4xx and is always false for 5xx, so server-side
// failures never leak schema, provider or stack details in a response body.

export interface AppErrorOptions {
  /** Stable machine-readable code returned to the client. */
  code?: string
  /** Override whether `message` is safe to return. Ignored for 5xx. */
  expose?: boolean
}

export class AppError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly expose: boolean

  constructor(message: string, statusCode = 500, { code, expose }: AppErrorOptions = {}) {
    super(message)
    this.name = new.target.name
    this.statusCode = statusCode
    this.code = code ?? defaultCode(statusCode)
    this.expose = statusCode < 500 && (expose ?? true)
  }
}

export class ValidationError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, 400, { code: 'validation_error', ...options })
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized', options: AppErrorOptions = {}) {
    super(message, 401, { code: 'unauthorized', ...options })
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', options: AppErrorOptions = {}) {
    super(message, 403, { code: 'forbidden', ...options })
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', options: AppErrorOptions = {}) {
    super(message, 404, { code: 'not_found', ...options })
  }
}

/** The requested transition or write conflicts with the current state. */
export class ConflictError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, 409, { code: 'conflict', ...options })
  }
}

/** A dependency is unavailable. The client sees only the generic message. */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable', options: AppErrorOptions = {}) {
    super(message, 503, { code: 'service_unavailable', ...options })
  }
}

function defaultCode(statusCode: number): string {
  if (statusCode === 400) return 'validation_error'
  if (statusCode === 401) return 'unauthorized'
  if (statusCode === 403) return 'forbidden'
  if (statusCode === 404) return 'not_found'
  if (statusCode === 409) return 'conflict'
  if (statusCode === 503) return 'service_unavailable'
  return statusCode >= 500 ? 'internal_error' : 'request_error'
}

// ── Classification ─────────────────────────────────────────────────────────────

export interface ClassifiedError {
  status: number
  code: string
  /** Client-safe message. */
  message: string
}

const SERVER_MESSAGES: Record<number, string> = {
  502: 'Bad gateway',
  503: 'Service unavailable',
  504: 'Gateway timeout',
}

/** Message returned for any 5xx, whatever the underlying error says. */
export function serverMessage(status: number): string {
  return SERVER_MESSAGES[status] ?? 'Internal server error'
}

/**
 * body-parser failures (malformed JSON, oversized or unsupported bodies) are
 * client errors raised before any route runs. Its error `type` values are
 * stable across versions.
 */
const BODY_PARSER_ERRORS: Record<string, ClassifiedError> = {
  'entity.parse.failed':  { status: 400, code: 'invalid_json', message: 'Request body is not valid JSON' },
  'entity.verify.failed': { status: 400, code: 'invalid_body', message: 'Request body could not be read' },
  'request.aborted':      { status: 400, code: 'request_aborted', message: 'Request was aborted' },
  'request.size.invalid': { status: 400, code: 'invalid_body', message: 'Request body size does not match Content-Length' },
  'entity.too.large':     { status: 413, code: 'payload_too_large', message: 'Request body is too large' },
  'encoding.unsupported': { status: 415, code: 'unsupported_encoding', message: 'Unsupported content encoding' },
  'charset.unsupported':  { status: 415, code: 'unsupported_charset', message: 'Unsupported request charset' },
}

function numericStatus(error: Record<string, unknown>): number | undefined {
  const status = error.statusCode ?? error.status
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : undefined
}

/** Map any thrown value to a status, a stable code, and a client-safe message. */
export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof AppError) {
    return {
      status: error.statusCode,
      code: error.code,
      message: error.expose ? error.message : serverMessage(error.statusCode),
    }
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    // Own entries only: an inherited key such as `constructor` or `__proto__`
    // must not be mistaken for a parser classification.
    if (typeof record.type === 'string' && Object.hasOwn(BODY_PARSER_ERRORS, record.type)) {
      return BODY_PARSER_ERRORS[record.type]
    }

    // Errors from libraries that carry an HTTP status (http-errors and the
    // like). Only 4xx messages are returned, and only when marked exposable.
    const status = numericStatus(record)
    if (status !== undefined && status < 500) {
      return {
        status,
        code: defaultCode(status),
        message: record.expose === true && typeof record.message === 'string'
          ? record.message
          : 'Request could not be processed',
      }
    }
    if (status !== undefined) {
      return { status, code: defaultCode(status), message: serverMessage(status) }
    }
  }

  return { status: 500, code: 'internal_error', message: serverMessage(500) }
}
