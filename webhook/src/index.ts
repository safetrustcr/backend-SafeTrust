import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import morgan from 'morgan'
import helmet from 'helmet'
import dotenv from 'dotenv'
dotenv.config()

import routes from './routes'
import reconciliationRoutes from './routes/reconciliation/sync-escrows.route'

const app = express()

const rawPort = process.env.WEBHOOK_PORT
const port = rawPort ? parseInt(rawPort, 10) : 3001

if (isNaN(port) || port < 1 || port > 65535) {
  console.error(`❌ Invalid WEBHOOK_PORT: "${rawPort}" — must be between 1 and 65535`)
  process.exit(1)
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

// ── Core middleware ───────────────────────────────────────────────────────────
app.use(cors())
app.use(morgan('dev'))
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
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Internal Server Error' })
})

app.listen(port, () => {
  console.log(`[api] Webhook service running at http://localhost:${port}`)
})

export default app