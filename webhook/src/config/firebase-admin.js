const { initializeApp, cert, getApps } = require('firebase-admin/app');

function initializeFirebaseAdmin() {
  if (getApps().length === 0) {
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Handle escaped newlines in private key
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };

    if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
      console.warn('[Firebase Admin] Missing configuration. Ensure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are set.');
    }

    initializeApp({
      credential: cert(serviceAccount),
    });
    
    console.log('[Firebase Admin] Initialized successfully');
  }
}

module.exports = { initializeFirebaseAdmin };
