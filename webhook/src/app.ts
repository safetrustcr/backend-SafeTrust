import express, { Application, Request, Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
dotenv.config()
import { initializeFirebaseAdmin } from './config/firebase-admin'
import { corsOptions, describeCorsPolicy, resolveCorsPolicy } from './config/cors'
import { bindRequestContext, logger, requestId } from './middleware/logger'
import { errorHandler, notFoundHandler } from './middleware/error-handler'

import routes from './routes'
import reconciliationRoutes from './routes/reconciliation/sync-escrows.route'

const app: Application = express()

// Ensure Firebase Admin is initialized before any auth middleware runs.
// Throws on failure so startup cannot proceed without a valid default app.
initializeFirebaseAdmin()

// ── Correlation FIRST — every response, including errors, gets X-Request-Id ──
app.use(requestId)

// ── Security headers — before any route mounts ───────────────────────────────
app.use(helmet())
app.use(helmet.noSniff())
app.use(helmet.frameguard({ action: 'deny' }))
app.use(helmet.hsts({
  maxAge: 31_536_000,
  includeSubDomains: true,
  preload: true,
}))

// ── CORS: explicit origin policy (see config/cors.ts and CORS_ALLOWED_ORIGINS) ─
const corsPolicy = resolveCorsPolicy()
logger.info('cors.policy', describeCorsPolicy(corsPolicy))
if (corsPolicy.kind === 'none') {
  logger.warn('cors.no_browser_origins', {
    hint: 'Set CORS_ALLOWED_ORIGINS to the frontend origin(s) so browsers can call the API',
  })
}
app.use(cors(corsOptions(corsPolicy)))

// ── Body parsing ──────────────────────────────────────────────────────────────
// `verify` keeps the exact request bytes on req.rawBody for HMAC verification
// of TrustlessWork callbacks; it runs before JSON parsing, so the signature
// check sees the bytes as sent. Parse failures reach the error handler as 400.
app.use(express.json({
  verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
    req.rawBody = buf
  }
}))

// Request id available to the logger in every handler and service from here.
app.use(bindRequestContext)

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/', routes)
app.use('/reconciliation', reconciliationRoutes)

// Liveness is intentionally independent of external dependencies.
app.get('/health/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' })
})

// ── Fallbacks ─────────────────────────────────────────────────────────────────
app.use(notFoundHandler)
app.use(errorHandler)

export default app
