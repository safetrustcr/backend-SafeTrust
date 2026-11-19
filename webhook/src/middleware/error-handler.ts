'use strict'

import { NextFunction, Request, Response } from 'express'
import { classifyError } from '../utils/errors'
import { sendError, notFound } from '../utils/response'
import { logger, requestPath } from './logger'

/** JSON 404 for unmatched routes, instead of Express's HTML page. */
export function notFoundHandler(req: Request, res: Response): void {
  notFound(res, { error: 'Route not found', code: 'route_not_found' })
}

/**
 * Global error handler: maps the AppError hierarchy (and body-parser errors)
 * to status codes and returns a sanitized body. 5xx are logged with the full
 * error for diagnosis; the client only sees the generic message and the
 * request id to quote when reporting the problem.
 */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    // Too late to send an error body; Express closes the connection.
    logger.error('http.error_after_headers_sent', {
      requestId: req.requestId,
      method: req.method,
      path: requestPath(req),
      error: err,
    })
    next(err)
    return
  }

  const { status, code } = classifyError(err)
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

  sendError(res, err)
}
