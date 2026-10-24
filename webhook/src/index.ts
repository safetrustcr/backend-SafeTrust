import { initializeFirebaseAdmin } from './config/firebase-admin'

try {
  initializeFirebaseAdmin()
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

import './server'
