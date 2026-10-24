import { Response } from 'express'
import { ApiDuplicate, ApiError, ApiSuccess } from '../types/response.types'

type ErrorInput = string | (Record<string, unknown> & { error: string })

/**
 * Canonical error body builder. Only the public `error` string (and explicitly
 * whitelisted extra fields passed by the caller) are ever serialized, so callers
 * cannot accidentally leak `err.details`, stacks, or internal field names by
 * spreading an error object into the response.
 */
const errorBody = (input: ErrorInput): ApiError => {
  if (typeof input === 'string') return { success: false, error: input }
  const { error, ...rest } = input
  return { success: false, ...rest, error }
}

export const ok = <T>(res: Response, data?: T): Response<ApiSuccess<T>> =>
  res.status(200).json({ success: true, ...(data === undefined ? {} : { data }) })

export const created = <T>(res: Response, data: T): Response<ApiSuccess<T>> =>
  res.status(201).json({ success: true, data })

export const badRequest = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(400).json(errorBody(error))

export const unauthorized = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(401).json(errorBody(error))

export const notFound = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(404).json(errorBody(error))

export const conflict = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(409).json(errorBody(error))

export const duplicate = (res: Response, eventId: string): Response<ApiDuplicate> =>
  res.status(200).json({ success: true, duplicate: true, eventId })

/**
 * 500 responses never echo the underlying error message. The caller supplies a
 * sanitized, generic message; the raw error must be logged server-side with the
 * requestId instead.
 */
export const serverError = (
  res: Response,
  error: ErrorInput = 'Internal server error',
): Response<ApiError> => res.status(500).json(errorBody(error))

export const serviceUnavailable = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(503).json(errorBody(error))
