import app from './app'
import { getHasuraAdminSecret } from './services/hasura'
import { initializeFirebaseAdmin } from './config/firebase-admin'
import { pool } from './services/db'
import { logger } from './middleware/logger'

const rawPort = process.env.WEBHOOK_PORT ?? process.env.PORT
const port = rawPort === undefined ? 3001 : Number(rawPort)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  logger.error('server.port.invalid', { rawPort })
  process.exit(1)
}

try {
  getHasuraAdminSecret()
  initializeFirebaseAdmin()
} catch (error) {
  logger.error('server.initialization_failed', { error })
  process.exit(1)
}

const server = app.listen(port, () => {
  logger.info('server.started', { port })
})

const shutdownTimeoutMs = 30_000
let shuttingDown = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  logger.info('server.shutdown.started', { signal })

  const timeout = setTimeout(() => {
    logger.error('server.shutdown.timeout', { timeoutMs: shutdownTimeoutMs })
    server.closeAllConnections()
    process.exit(1)
  }, shutdownTimeoutMs)

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
    await pool.end()
    logger.info('server.shutdown.completed')
    process.exitCode = 0
  } catch (error) {
    logger.error('server.shutdown.failed', { error })
    process.exitCode = 1
  } finally {
    clearTimeout(timeout)
  }
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)