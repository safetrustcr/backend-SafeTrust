export interface ApiSuccess<T = void> {
  success: true
  data?: T
}

export interface ApiError {
  success: false
  error: string
  code?: string
  /** Client-facing details for 4xx only; never set on a 5xx body. */
  details?: unknown
  /** Correlation id, also returned as the `X-Request-Id` header. */
  requestId?: string
}

export interface ApiDuplicate {
  success: true
  duplicate: true
  eventId: string
}

export type ApiResponse<T = void> = ApiSuccess<T> | ApiError | ApiDuplicate
