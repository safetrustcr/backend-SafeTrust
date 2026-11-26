import express, { Application, Request, Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
dotenv.config()
import { initializeFirebaseAdmin } from './config/firebase-admin'
import { corsOptions, describeCorsPolicy, resolveCorsPolicy } from './config/cors'
import { bindRequestContext, logger, requestId } from './middleware/logger'
import { errorHandler, notFoundHandler } from './middleware/error-handler'
import {
  apiIpRateLimit,
  authIpRateLimit,
  healthRateLimit,
  publicRateLimit,
} from './middleware/rate-limit'

import routes from './routes'
import reconciliationRoutes from './routes/reconciliation/sync-escrows.route'

const app: Application = express()

const trustProxy = process.env.TRUST_PROXY?.trim()
app.set(
  'trust proxy',
  !trustProxy
    ? false
    : /^\d+$/.test(trustProxy)
      ? Number(trustProxy)
      : trustProxy === 'true'
        ? true
        : trustProxy === 'false'
          ? false
          : trustProxy.split(',').map((value) => value.trim())
)

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

// ── Request limits ────────────────────────────────────────────────────────────
app.use('/health', healthRateLimit)
app.use('/api/escrows/initialize', publicRateLimit)
app.use('/reconciliation', publicRateLimit)
app.use('/api', apiIpRateLimit)
app.use('/api/auth', authIpRateLimit)

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '100kb' }))

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
