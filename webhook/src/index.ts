import 'dotenv/config'
import { initializeFirebaseAdmin } from './config/firebase-admin'
import { validateStellarConfig } from './config/stellar'

try {
  initializeFirebaseAdmin()
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

const stellarValidation = validateStellarConfig()
if (!stellarValidation.valid) {
  for (const err of stellarValidation.errors) {
    console.error(`❌ Stellar Config Error: ${err}`)
  }
  process.exit(1)
}

import './server'
