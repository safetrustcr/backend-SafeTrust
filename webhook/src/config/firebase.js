const admin = require('firebase-admin');

if (!admin.apps.length) {
  if (!process.env.FIREBASE_PROJECT_ID) {
    throw new Error('FIREBASE_PROJECT_ID is required to initialize Firebase Admin');
  }

  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
  
  console.log('Firebase Admin initialized');
}

module.exports = admin;
