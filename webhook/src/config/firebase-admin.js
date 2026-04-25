const { initializeApp, cert, getApps } = require('firebase-admin/app');

/**
 * Initializes Firebase Admin with service account credentials when fully configured.
 * In non-production, missing env vars skip init so mock-token tests can run without Firebase.
 *
 * @returns {void}
 */
function initializeFirebaseAdmin() {
  if (getApps().length > 0) {
    return;
  }

  const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };

  if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
    const msg =
      '[Firebase Admin] Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY';
    if (process.env.NODE_ENV === 'production') {
      throw new Error(msg);
    }
    console.warn(`${msg} — skipping cert init (non-production)`);
    return;
  }

  initializeApp({
    credential: cert(serviceAccount),
  });

  console.log('[Firebase Admin] Initialized successfully');
}

module.exports = { initializeFirebaseAdmin };
