import express, { Application, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import morgan from 'morgan'
import helmet from 'helmet'
import dotenv from 'dotenv'
import { randomUUID } from 'crypto'
dotenv.config()

import routes from './routes'
import reconciliationRoutes from './routes/reconciliation/sync-escrows.route'

const app: Application = express()

// ── Error hierarchy (move to utils/errors.ts when extracted) ─────────────────
export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'AppError'
  }
}
export class ValidationError extends AppError {
  constructor(message = 'Bad Request') { super(400, message) }
}
export class AuthError extends AppError {
  constructor(message = 'Unauthorized') { super(401, message) }
}
export class StateConflictError extends AppError {
  constructor(message = 'Conflict') { super(409, message) }
}

// ── Security headers FIRST — before any route mounts ─────────────────────────
app.use(helmet())
app.use(helmet.noSniff())
app.use(helmet.frameguard({ action: 'deny' }))
app.use(helmet.hsts({
  maxAge: 31_536_000,
  includeSubDomains: true,
  preload: true,
}))

// ── Request context: correlation ID ───────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID()
  ;(req as any).context = { requestId }
  res.setHeader('x-request-id', requestId)
  next()
})

// ── Core middleware ───────────────────────────────────────────────────────────
// CORS: explicit allowlist from env. Set CORS_ORIGINS="https://app.example.com,https://admin.example.com"
const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)
app.use(cors({
  origin: (origin, callback) => {
    // Non-browser clients (webhooks, server-to-server) send no Origin header.
    if (!origin) return callback(null, true)
    callback(null, allowedOrigins.includes(origin))
  },
}))
app.use(morgan('dev'))
app.use(express.json({
  verify: (req: any, _res, buf) => {
    // Raw body preserved for webhook signature verification.
    req.rawBody = buf
  }
}))

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/', routes)
app.use('/reconciliation', reconciliationRoutes)

// Liveness is intentionally independent of external dependencies.
app.get('/health/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' })
})

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const requestId = (req as any).context?.requestId

  // Body-parse failures from express.json() carry type 'entity.parse.failed'
  // and a 4xx status; classify them as 400 rather than 500.
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Bad Request', requestId })
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, requestId })
  }

  // Log full detail server-side only; never send it to the client.
  console.error(JSON.stringify({ level: 'error', requestId, event: 'unhandled', message: err?.message, stack: err?.stack }))
  res.status(500).json({ error: 'Internal Server Error', requestId })
})

export default app
