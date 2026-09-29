export interface ApiSuccess<T = void> {
  success: true
  data?: T
}

export interface ApiError {
  success: false
  error: string
  code?: string
  details?: unknown
}

export interface ApiDuplicate {
  success: true
  duplicate: true
  eventId: string
}

export type ApiResponse<T = void> = ApiSuccess<T> | ApiError | ApiDuplicate
