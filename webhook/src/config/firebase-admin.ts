import { initializeApp, cert, getApp, type ServiceAccount } from 'firebase-admin/app'

/**
 * Firebase Admin initialization.
 *
 * Credential strategy: explicit service-account configuration via the
 * FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY env vars.
 * (Application Default Credentials are not used, so deployments are explicit
 * about which service account authenticates token verification.)
 *
 * In production, missing configuration throws so the process fails at startup
 * rather than producing misleading 401 responses at request time.
 * In non-production, missing configuration is skipped so mock-token tests can run.
 */
export function initializeFirebaseAdmin(): void {
  let defaultAppExists: boolean
  try {
    getApp()
    defaultAppExists = true
  } catch {
    defaultAppExists = false
  }
  if (defaultAppExists) {
    return
  }

  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (!projectId || !clientEmail || !privateKey) {
    const msg =
      '[Firebase Admin] Missing FIREBASE_PROJECT_ID, ' +
      'FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY'
    if (process.env.NODE_ENV === 'production') {
      throw new Error(msg)
    }
    console.warn(`${msg} — skipping cert init (non-production)`)
    return
  }

  const serviceAccount: ServiceAccount = { projectId, clientEmail, privateKey }
  initializeApp({ credential: cert(serviceAccount) })
  console.log('[Firebase Admin] Initialized successfully')
}
