import { app } from './app'
import { initializeFirebaseAdmin } from './config/firebase-admin'

async function bootstrap(): Promise<void> {
  // Fail hard: if Firebase Admin cannot initialize, do not start the server.
  // initializeFirebaseAdmin throws when required auth configuration is absent.
  await initializeFirebaseAdmin()

  // Importing the server module starts the HTTP listener (app.listen).
  await import('./server')
}

if (require.main === module) {
  bootstrap().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Fatal startup error:', error)
    process.exit(1)
  })
}

export { bootstrap, app }
