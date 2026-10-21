'use strict'

import { Response } from 'express'

export interface AppErrorOptions {
  code?: string
  details?: Record<string, unknown>
  cause?: unknown
}

/**
 * Base class for all errors that carry an explicit HTTP status code.
 * The global error handler maps `statusCode` to the response status and
 * only ever serializes `safeMessage` + code (never `details` or stack) for 500s.
 */
export class AppError extends Error {
  public readonly statusCode: number
  public readonly code: string
  public readonly details?: Record<string, unknown>
  public readonly exposeMessage: boolean

  constructor(
    message: string,
    statusCode: number,
    code: string,
    options: AppErrorOptions = {},
    exposeMessage = true
  ) {
    super(message)
    this.name = new.target.constructor.name
    this.statusCode = statusCode
    this.code = options.code ?? code
    this.details = options.details
    this.exposeMessage = exposeMessage
    if (options.cause !== undefined) {
      ;(this as { cause?: unknown }).cause = options.cause
    }
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /** Message safe to return in an HTTP response body. */
  public get safeMessage(): string {
    return this.exposeMessage ? this.message : 'Internal Server Error'
  }
}

/** 400 - malformed request input (including body-parse failures). */
export class ValidationError extends AppError {
  constructor(message = 'Invalid request', options: AppErrorOptions = {}) {
    super(message, 400, 'VALIDATION_ERROR', options)
  }
}

/** 401 - missing or invalid credentials. */
export class AuthError extends AppError {
  constructor(message = 'Unauthorized', options: AppErrorOptions = {}) {
    super(message, 401, 'AUTH_ERROR', options)
  }
}

/** 403 - authenticated but not allowed. */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', options: AppErrorOptions = {}) {
    super(message, 403, 'FORBIDDEN', options)
  }
}

/** 404 - resource not found. */
export class NotFoundError extends AppError {
  constructor(message = 'Not Found', options: AppErrorOptions = {}) {
    super(message, 404, 'NOT_FOUND', options)
  }
}

/** 409 - request conflicts with current state. */
export class StateConflictError extends AppError {
  constructor(message = 'State conflict', options: AppErrorOptions = {}) {
    super(message, 409, 'STATE_CONFLICT', options)
  }
}

/** 503 - dependent service unavailable. */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service Unavailable', options: AppErrorOptions = {}) {
    super(message, 503, 'SERVICE_UNAVAILABLE', options)
  }
}

/** 500 - unknown internal failure. Message is always sanitized. */
export class InternalError extends AppError {
  constructor(message = 'Internal Server Error', options: AppErrorOptions = {}) {
    super(message, 500, 'INTERNAL_ERROR', options, false)
  }
}

/** Normalize any thrown value into an AppError with a status code. */
export const toAppError = (err: unknown): AppError => {
  if (err instanceof AppError) {
    return err
  }

  // express.json / body-parser failures carry a numeric `status` and `type`.
  const candidate = err as { status?: number; statusCode?: number; type?: string; message?: string }
  const status = candidate.status ?? candidate.statusCode

  if (typeof status === 'number' && status >= 400 && status < 500) {
    if (status === 400) {
      return new ValidationError('Invalid request body')
    }
    if (status === 401) {
      return new AuthError()
    }
    if (status === 403) {
      return new ForbiddenError()
    }
    if (status === 404) {
      return new NotFoundError()
    }
    if (status === 409) {
      return new StateConfllictError()
    }
    return new AppError('Request error', status, 'REQUEST_ERROR', {}, false)
  }

  return new InternalError(undefined, { cause: err })
}

/** Serialize an AppError into a safe response body (no details/stack for 5xx). */
export const toErrorBody = (error: AppError): { success: false; error: string; code: string; details?: Record<string, unknown> } => {
  const body: { success: false; error: string; code: string; details?: Record<string, unknown> } = {
    success: false,
    error: error.safeMessage,
    code: error.code,
  }
  // Only client-side (4xx) errors may expose structured details.
  if (error.statusCode < 500 && error.details !== undefined) {
    body.details = error.details
  }
  return body
}

/** Send an AppError using the canonical response shape. */
export const sendError = (res: Response, error: AppError): Response =>
  res.status(error.statusCode).json(toErrorBody(error))
