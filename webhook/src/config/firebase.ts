import admin = require('firebase-admin');
import { getApps, initializeApp } from 'firebase-admin/app';

if (!getApps().length) {
  if (!process.env.FIREBASE_PROJECT_ID) {
    throw new Error('FIREBASE_PROJECT_ID is required to initialize Firebase Admin');
  }

  initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
  
  console.log('Firebase Admin initialized');
}

export = admin;
