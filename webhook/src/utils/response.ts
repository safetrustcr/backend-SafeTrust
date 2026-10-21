import { Response } from 'express'
import { ApiDuplicate, ApiError, ApiSuccess } from '../types/response.types'
import { AppError, sendError } from './errors'

type ErrorInput = string | (Record<string, unknown> & { error: string })

const errorBody = (input: ErrorInput): ApiError => {
  if (typeof input === 'string') return { success: false, error: input }
  return { success: false, ...input }
}

export const ok = <T>(res: Response, data?: T): Response<ApiSuccess<T>> =>
  res.status(200).json({ success: true, ...(data === undefined ? {} : { data }) })

export const created = <T>(res: Response, data: T): Response<ApiSuccess<T>> =>
  res.status(201).json({ success: true, data })

export const badRequest = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(400).json(errorBody(error))

export const unauthorized = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(401).json(errorBody(error))

export const forbidden = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(403).json(errorBody(error))

export const notFound = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(404).json(errorBody(error))

export const conflict = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(409).json(errorBody(error))

export const duplicate = (res: Response, eventId: string): Response<ApiDuplicate> =>
  res.status(200).json({ success: true, duplicate: true, eventId })

/**
 * Canonical 500 response. Accepts a string or shape for backward compat,
 * but callers should prefer sendingAppError so internal details are never leaked.
 */
export const serverError = (res: Response, _error?: ErrorInput): Response<ApiError> =>
  res.status(500).json({ success: false, error: 'Internal Server Error', code: 'INTERNAL_ERROR' })

export const serviceUnavailable = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(503).json(errorBody(error))

/** Single entry point for sending a typed AppError. */
export const appError = (res: Response, error: AppError): Response => sendError(res, error)
