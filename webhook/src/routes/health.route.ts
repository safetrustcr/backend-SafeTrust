import express, { Request, Response } from 'express'
import { getApps } from 'firebase-admin/app'
import { pool } from '../services/db'

const router = express.Router()

router.get('/health/ready', async (_req: Request, res: Response) => {
  const firebase = getApps().some((app) => app.name === '[DEFAULT]')
  let database = false

  try {
    await pool.query({ text: 'SELECT 1', query_timeout: 200 })
    database = true
  } catch (error) {
    console.error(
      '[health] Database readiness check failed:',
      error instanceof Error ? error.message : String(error)
    )
  }

  const ready = firebase && database
  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    dependencies: { firebase, database },
  })
})

export default router
