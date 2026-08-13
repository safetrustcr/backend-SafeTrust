import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import morgan from 'morgan'

import routes from './routes'
import reconciliationRoutes from './routes/reconciliation/sync-escrows.route'

const app = express()
const port = process.env.WEBHOOK_PORT ?? 3001

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