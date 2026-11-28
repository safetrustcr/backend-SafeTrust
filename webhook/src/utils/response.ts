import { Response } from 'express'
import { ApiDuplicate, ApiSuccess } from '../types/response.types'

export const ok = <T>(res: Response, data?: T): Response<ApiSuccess<T>> =>
  res.status(200).json({ success: true, ...(data === undefined ? {} : { data }) })

export const created = <T>(res: Response, data: T): Response<ApiSuccess<T>> =>
  res.status(201).json({ success: true, data })

export const duplicate = (res: Response, eventId: string): Response<ApiDuplicate> =>
  res.status(200).json({ success: true, duplicate: true, eventId })
