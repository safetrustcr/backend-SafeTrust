import app from './app'
import { getHasuraAdminSecret } from './services/hasura'
import { initializeFirebaseAdmin } from './config/firebase-admin'
import { pool } from './services/db'

const rawPort = process.env.WEBHOOK_PORT ?? process.env.PORT
const port = rawPort === undefined ? 3001 : Number(rawPort)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`❌ Invalid WEBHOOK_PORT: "${rawPort}" — must be between 1 and 65535`)
  process.exit(1)
}

try {
  getHasuraAdminSecret()
  initializeFirebaseAdmin()
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

const server = app.listen(port, () => {
  console.log(`[api] Webhook service running at http://localhost:${port}`)
})

const shutdownTimeoutMs = 30_000
let shuttingDown = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  console.log(`[api] ${signal} received; stopping server and draining requests`)

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.warn(`[api] Shutdown deadline reached; closing active connections`)
        server.closeAllConnections()
      }, shutdownTimeoutMs)

      server.close((error) => {
        clearTimeout(timeout)
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
    await pool.end()
    console.log('[api] Shutdown complete')
    process.exitCode = 0
  } catch (error) {
    console.error('[api] Graceful shutdown failed:', error)
    process.exitCode = 1
  }
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
