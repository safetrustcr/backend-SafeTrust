import { Response } from 'express'
import { ApiDuplicate, ApiError, ApiSuccess } from '../types/response.types'

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

export const notFound = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(404).json(errorBody(error))

export const duplicate = (res: Response, eventId: string): Response<ApiDuplicate> =>
  res.status(200).json({ success: true, duplicate: true, eventId })

export const serverError = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(500).json(errorBody(error))

export const serviceUnavailable = (res: Response, error: ErrorInput): Response<ApiError> =>
  res.status(503).json(errorBody(error))
