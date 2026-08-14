import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import morgan from 'morgan'
import dotenv from 'dotenv'
dotenv.config()

import routes from './routes'
import reconciliationRoutes from './routes/reconciliation/sync-escrows.route'

const app = express()

// Convert and validate port — Express requires a number
const rawPort = process.env.WEBHOOK_PORT
const port = rawPort ? parseInt(rawPort, 10) : 3001

if (isNaN(port) || port < 1 || port > 65535) {
  console.error(`❌ Invalid WEBHOOK_PORT: "${rawPort}" — must be a number between 1 and 65535`)
  process.exit(1)
}

app.use(cors())
app.use(morgan('dev'))
app.use(express.json())

app.use('/', routes)
app.use('/reconciliation', reconciliationRoutes)

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' })
})

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Internal Server Error' })
})

app.listen(port, () => {
  console.log(`[api] Webhook service running at http://localhost:${port}`)
})

export default app