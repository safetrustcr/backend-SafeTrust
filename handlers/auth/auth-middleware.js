import admin from 'firebase-admin';

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

/**
 * Summary: Middleware to verify Firebase JWT tokens and protect API routes
 * 
 * Details:
 * - Extracts JWT token from Authorization header
 * - Verifies token using Firebase Admin SDK
 * - Adds user context to request object
 * - Handles authentication errors appropriately
 */
export const verifyFirebaseToken = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return handleAuthErrors(res, 'MISSING_TOKEN', 'Authorization header missing or invalid format');
    }

    const token = authHeader.split('Bearer ')[1];
    
    if (!token) {
      return handleAuthErrors(res, 'MISSING_TOKEN', 'JWT token not provided');
    }

    // Verify the Firebase JWT token
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    // Add user context to request
    req.user = addUserContext(decodedToken);
    
    next();
  } catch (error) {
    console.error('Firebase token verification error:', error);
    
    // Handle different types of Firebase auth errors
    if (error.code === 'auth/id-token-expired') {
      return handleAuthErrors(res, 'TOKEN_EXPIRED', 'JWT token has expired');
    } else if (error.code === 'auth/invalid-id-token') {
      return handleAuthErrors(res, 'INVALID_TOKEN', 'Invalid JWT token');
    } else if (error.code === 'auth/project-not-found') {
      return handleAuthErrors(res, 'CONFIG_ERROR', 'Firebase project configuration error');
    } else {
      return handleAuthErrors(res, 'AUTH_ERROR', 'Authentication failed');
    }
  }
};

/**
 * Summary: Adds user context to the request object
 * 
 * Details:
 * - Extracts relevant user information from decoded Firebase token
 * - Creates a clean user object for use in protected routes
 * 
 * @param {Object} decodedToken - Decoded Firebase JWT token
 * @returns {Object} User context object
 */
export const addUserContext = (decodedToken) => {
  return {
    uid: decodedToken.uid,
    email: decodedToken.email,
    emailVerified: decodedToken.email_verified,
    name: decodedToken.name,
    picture: decodedToken.picture,
    authTime: decodedToken.auth_time,
    iat: decodedToken.iat,
    exp: decodedToken.exp,
    // Add any custom claims if they exist
    customClaims: decodedToken.customClaims || {},
  };
};

/**
 * Summary: Handles authentication errors with consistent error responses
 * 
 * Details:
 * - Provides standardized error responses for different auth failure scenarios
 * - Logs errors for monitoring and debugging
 * - Returns appropriate HTTP status codes
 * 
 * @param {Object} res - Express response object
 * @param {String} errorType - Type of authentication error
 * @param {String} message - Error message
 */
export const handleAuthErrors = (res, errorType, message) => {
  const errorResponses = {
    MISSING_TOKEN: { status: 401, code: 'AUTH_001' },
    INVALID_TOKEN: { status: 401, code: 'AUTH_002' },
    TOKEN_EXPIRED: { status: 401, code: 'AUTH_003' },
    CONFIG_ERROR: { status: 500, code: 'AUTH_004' },
    AUTH_ERROR: { status: 401, code: 'AUTH_005' }
  };

  const errorConfig = errorResponses[errorType] || { status: 401, code: 'AUTH_000' };
  
  console.error(`Authentication Error [${errorConfig.code}]:`, message);
  
  return res.status(errorConfig.status).json({
    success: false,
    error: {
      code: errorConfig.code,
      type: errorType,
      message: message,
    },
    timestamp: new Date().toISOString(),
  });
};

/**
 * Summary: Route protection wrapper for easy middleware application
 * 
 * Details:
 * - Convenience function to apply authentication middleware to routes
 * - Can be used with Express router or individual routes
 * 
 * Usage:
 * app.get('/protected-route', protectRoute(), (req, res) => {
 *   // req.user contains Firebase user data
 *   res.json({ message: 'Protected data', user: req.user });
 * });
 */
export const protectRoute = () => {
  return verifyFirebaseToken;
};

// Default export for convenience
export default {
  verifyFirebaseToken,
  addUserContext,
  handleAuthErrors,
  protectRoute,
};