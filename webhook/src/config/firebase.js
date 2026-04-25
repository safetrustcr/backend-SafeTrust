const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    // In a real scenario, we'd use service account JSON or environment variables
    // For this task, we'll assume the environment provides necessary credentials
    // if (process.env.FIREBASE_SERVICE_ACCOUNT) { ... }
    
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    console.log('Firebase Admin initialized');
  } catch (error) {
    console.error('Firebase Admin initialization error:', error.message);
  }
}

module.exports = admin;
