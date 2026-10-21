import express, { Application, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import morgan from 'morgan'
import helmet from 'helmet'
import dotenv from 'dotenv'
dotenv.config()

import { AppError, BodyParseError } from './utils/errors'
import { requestLogger, structuredLogger } from './middleware/logger'

import routes from './routes'
import reconciliationRoutes from './routes/reconciliation/sync-escrows.route'

const app: Application = express()

// ── Security headers FIRST — before any route mounts ─────────────────────────
app.use(helmet())
app.use(helmet.noSniff())
app.use(helmet.frameguard({ action: 'deny' }))
app.use(helmet.hsts({
  maxAge: 31_536_000,
  includeSubDomains: true,
  preload: true,
}))

// ── Core middleware ───────────────────────────────────────────────────────────
// CORS: explicit allowlist for browser clients. In production, set
// CORS_ALLOWED_ORIGINS to a comma-separated list of trusted origins.
// Wildcard ('*') is only used when the env var is unset AND NODE_ENV !== 'production'.
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true) // non-browser clients
    if (allowedOrigins.length > 0) {
      return allowedOrigins.includes(origin)
        ? callback(null, true)
        : callback(new Error('Not allowed by CORS'))
    }
    // No allowlist configured: permit any origin only outside production.
    if (process.env.NODE_ENV !== 'production') return callback(null, true)
    return callback(new Error('CORS origin not configured'))
  },
  credentials: true,
}))
app.use(morgan('dev'))
app.use(requestLogger)
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf
  }
}))

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/', routes)
app.use('/reconciliation', reconciliationRoutes)

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' })
})

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const requestId = (req as any).context?.requestId

  // Body-parser errors surface as SyntaxError with a `body`/`type` field.
  const isBodyParseError =
    err instanceof SyntaxError && (err as any).type === 'entity.parse.failed'

  const appError: AppError = isBodyParseError
    ? new BodyParseError('Malformed request body')
    : err instanceof AppError
      ? err
      : new AppError('Internal Server Error', 500, 'INTERNAL_ERROR')

  structuredLogger.error('request.error', {
    requestId,
    statusCode: appError.statusCode,
    errorCode: appError.code,
    error: err instanceof Error ? err.message : String(err),
  })

  // Never leak err.details, stack traces, or internal field names on 500.
  const body: Record<string, unknown> = {
    error: appError.statusCode >= 500 ? 'Internal Server Error' : appError.message,
    code: appError.code,
  }
  if (appError.statusCode < 500 && appError.details !== undefined) {
    body.details = appError.details
  }
  if (requestId) body.requestId = requestId

  res.status(appError.statusCode).json(body)
})

export default app
