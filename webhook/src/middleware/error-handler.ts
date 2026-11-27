'use strict'

import { NextFunction, Request, Response } from 'express'
import { AppError, classifyError, NotFoundError } from '../utils/errors'
import { getRequestId, logger, requestPath } from './logger'
import { ApiError } from '../types/response.types'

/** JSON 404 for unmatched routes, instead of Express's HTML page. */
export function notFoundHandler(req: Request, res: Response, next?: NextFunction): void {
  const err = new NotFoundError('Route not found', { code: 'route_not_found' })
  if (typeof next === 'function') {
    next(err)
  } else {
    errorHandler(err, req, res, () => {})
  }
}

/**
 * Global error handler: maps the AppError hierarchy (and body-parser errors)
 * to status codes and returns a sanitized body. 5xx are logged with the full
 * error for diagnosis; the client only sees the generic message and the
 * request id to quote when reporting the problem.
 */
export function errorHandler(err: unknown, req: Request, res: Response, next?: NextFunction): void {
  if (res.headersSent) {
    // Too late to send an error body; Express closes the connection.
    logger.error('http.error_after_headers_sent', {
      requestId: req.requestId,
      method: req.method,
      path: requestPath(req),
      error: err,
    })
    if (typeof next === 'function') {
      next(err)
    }
    return
  }

  if (err instanceof AppError && err.headers) {
    for (const [key, value] of Object.entries(err.headers)) {
      res.set(key, value)
    }
  }

  const { status, code, message } = classifyError(err)
  const fields = {
    requestId: req.requestId,
    method: req.method,
    path: requestPath(req),
    status,
    code,
  }

  if (status >= 500) {
    logger.error('http.unhandled_error', { ...fields, error: err })
  } else {
    logger.warn('http.request_rejected', fields)
  }

  const requestId = req.requestId ?? res.req?.requestId ?? getRequestId()
  const details = err instanceof AppError && err.expose && err.details ? err.details : undefined
  const body: ApiError & Record<string, unknown> = {
    ...(details ?? {}),
    success: false,
    error: message,
    ...(code ? { code } : {}),
    ...(requestId ? { requestId } : {}),
  }

  res.status(status).json(body)
}
