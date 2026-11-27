import 'dotenv/config'
import { initializeFirebaseAdmin } from './config/firebase-admin'
import { logger } from './middleware/logger'

try {
  initializeFirebaseAdmin()
} catch (error) {
  logger.error('server.firebase_admin.initialization_failed', { error })
  process.exit(1)
}

import './server'
