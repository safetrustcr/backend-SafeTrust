const admin = require('firebase-admin');

if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  
  if (!projectId && process.env.NODE_ENV === 'production') {
    console.error('FATAL: FIREBASE_PROJECT_ID is not set in production');
    process.exit(1);
  }

  try {
    admin.initializeApp({
      projectId: projectId || 'mock-project-id',
    });
    console.log('Firebase Admin initialized');
  } catch (error) {
    console.error('FATAL: Firebase Admin initialization error:', error.message);
    process.exit(1);
  }
}

module.exports = admin;
