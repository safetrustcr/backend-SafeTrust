const admin = require('firebase-admin');
const { logger } = require('../utils/logger');

// Track Firebase initialization state
let firebaseInitialized = false;

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
  const missing = required.filter(k => !process.env[k]?.trim());

  if (missing.length) {
    logger.error(`Missing Firebase env vars: ${missing.join(', ')}`);
  } else {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
      firebaseInitialized = true;
      logger.info('Firebase Admin SDK initialized');
    } catch (error) {
      logger.error('Failed to initialize Firebase Admin SDK', { error: error.message });
    }
  }
} else {
  firebaseInitialized = true;
}

/**
 * Middleware to verify Firebase JWT tokens
 * Extracts token from Authorization header and verifies it
 * Adds user context to request object
 */
async function verifyFirebaseToken(req, res, next) {
  try {
    // Check if Firebase is initialized
    if (!firebaseInitialized) {
      return res.status(503).json({
        success: false,
        message: 'Authentication service unavailable',
        code: 'AUTH_UNAVAILABLE',
      });
    }

    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Missing or invalid Authorization header', {
        endpoint: req.path,
        ip: req.ip,
      });
      return res.status(401).json({
        success: false,
        message: 'Authorization header missing or invalid format',
        code: 'MISSING_TOKEN',
      });
    }

    const token = authHeader.split('Bearer ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'JWT token not provided',
        code: 'MISSING_TOKEN',
      });
    }

    // Verify the Firebase JWT token
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    // Add user context to request
    req.user = {
      uid: decodedToken.uid,
      userId: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      name: decodedToken.name,
      picture: decodedToken.picture,
      role: decodedToken['https://hasura.io/jwt/claims']?.['x-hasura-default-role'] || 'user',
      customClaims: decodedToken['https://hasura.io/jwt/claims'] || {},
    };

    logger.debug('Firebase token verified', {
      userId: req.user.userId,
      role: req.user.role,
    });
    
    next();
  } catch (error) {
    logger.error('Firebase token verification error', {
      error: error.message,
      code: error.code,
      endpoint: req.path,
    });
    
    // Handle different types of Firebase auth errors
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        message: 'JWT token has expired',
        code: 'TOKEN_EXPIRED',
      });
    } else if (error.code === 'auth/invalid-id-token' || error.code === 'auth/argument-error') {
      return res.status(401).json({
        success: false,
        message: 'Invalid JWT token',
        code: 'INVALID_TOKEN',
      });
    } else {
      return res.status(401).json({
        success: false,
        message: 'Authentication failed',
        code: 'AUTH_ERROR',
      });
    }
  }
}

/**
 * Optional authentication middleware
 * Verifies token if present, but allows request to proceed if not
 */
async function optionalFirebaseAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = { role: 'anonymous' };
      return next();
    }

    const token = authHeader.split('Bearer ')[1];
    
    if (!token) {
      req.user = { role: 'anonymous' };
      return next();
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    
    req.user = {
      uid: decodedToken.uid,
      userId: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      name: decodedToken.name,
      role: decodedToken['https://hasura.io/jwt/claims']?.['x-hasura-default-role'] || 'user',
      customClaims: decodedToken['https://hasura.io/jwt/claims'] || {},
    };
    
    next();
  } catch (error) {
    logger.debug('Optional auth failed, proceeding as anonymous', {
      error: error.message,
    });
    req.user = { role: 'anonymous' };
    next();
  }
}

module.exports = {
  verifyFirebaseToken,
  optionalFirebaseAuth,
};
