import { Request } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import type { AuthenticatedRequest } from './auth.middleware'

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') return fallback

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function userOrIpKey(req: Request): string {
  const uid = (req as AuthenticatedRequest).context?.uid
  return uid ? `user:${uid}` : ipKeyGenerator(req.ip || req.socket.remoteAddress || 'unknown')
}

function createLimiter(windowEnv: string, limitEnv: string, defaultLimit: number) {
  return rateLimit({
    windowMs: positiveIntegerEnv(windowEnv, 15 * 60 * 1000),
    limit: positiveIntegerEnv(limitEnv, defaultLimit),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
  })
}

// Applied before authentication to bound invalid-token and anonymous traffic.
export const apiIpRateLimit = createLimiter('API_RATE_LIMIT_WINDOW_MS', 'API_IP_RATE_LIMIT_MAX', 300)

// Applied after authentication, so valid API traffic is isolated by user ID.
export const apiRateLimit = rateLimit({
  windowMs: positiveIntegerEnv('API_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: positiveIntegerEnv('API_RATE_LIMIT_MAX', 100),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'Too many requests' },
})

export const authRateLimit = rateLimit({
  windowMs: positiveIntegerEnv('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: positiveIntegerEnv('AUTH_RATE_LIMIT_MAX', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'Too many requests' },
})

// Unauthenticated auth-endpoint traffic is keyed by IP before token verification.
export const authIpRateLimit = createLimiter(
  'AUTH_RATE_LIMIT_WINDOW_MS',
  'AUTH_RATE_LIMIT_MAX',
  10
)

export const publicRateLimit = createLimiter(
  'PUBLIC_RATE_LIMIT_WINDOW_MS',
  'PUBLIC_RATE_LIMIT_MAX',
  60
)

export const healthRateLimit = createLimiter(
  'HEALTH_RATE_LIMIT_WINDOW_MS',
  'HEALTH_RATE_LIMIT_MAX',
  600
)
