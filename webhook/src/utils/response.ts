import { Response } from 'express'
import { ApiDuplicate, ApiError, ApiSuccess } from '../types/response.types'
import { classifyError, serverMessage } from './errors'
import { getRequestId } from '../middleware/logger'

// Canonical response helpers. Every error body has the shape
// { success: false, error, code?, requestId? }. Handlers that still write
// their own shapes move to these helpers incrementally.

type ErrorInput = string | (Record<string, unknown> & { error: string })

function requestIdOf(res: Response): string | undefined {
  return res.req?.requestId ?? getRequestId()
}

const errorBody = (res: Response, input: ErrorInput): ApiError => {
  const requestId = requestIdOf(res)
  const body: ApiError = typeof input === 'string'
    ? { success: false, error: input }
    : { success: false, ...input }
  return requestId ? { ...body, requestId } : body
}

/**
 * 5xx bodies carry a fixed message and an optional code only: never
 * `details`, a stack, or a driver/provider message. Log those instead.
 */
const serverErrorBody = (res: Response, status: number, input?: ErrorInput): ApiError => {
  const message = typeof input === 'string' ? input : input?.error
  const code = typeof input === 'object' && typeof input.code === 'string' ? input.code : undefined
  return errorBody(res, {
    error: message ?? serverMessage(status),
    ...(code ? { code } : {}),
  })
}

export const ok = <T>(res: Response, data?: T): Response<ApiSuccess<T>> =>
  res.status(200).json({ success: true, ...(data === undefined ? {} : { data }) })

export const created = <T>(res: Response, data: T): Response<ApiSuccess<T>> =>
  res.status(201).json({ success: true, data })

export const badRequest = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(400).json(errorBody(res, error))

export const unauthorized = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(401).json(errorBody(res, error))

export const forbidden = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(403).json(errorBody(res, error))

export const notFound = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(404).json(errorBody(res, error))

export const conflict = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(409).json(errorBody(res, error))

export const duplicate = (res: Response, eventId: string): Response<ApiDuplicate> =>
  res.status(200).json({ success: true, duplicate: true, eventId })

export const serverError = (res: Response, error?: ErrorInput): Response<ApiError> =>
  res.status(500).json(serverErrorBody(res, 500, error))

export const serviceUnavailable = (res: Response, error?: ErrorInput): Response<ApiError> =>
  res.status(503).json(serverErrorBody(res, 503, error))

/**
 * Respond for any thrown value using the AppError mapping. 4xx errors return
 * their client-safe message; everything else returns a sanitized 5xx.
 */
export const sendError = (res: Response, error: unknown): Response<ApiError> => {
  const { status, code, message } = classifyError(error)
  return res.status(status).json(errorBody(res, { error: message, code }))
}
