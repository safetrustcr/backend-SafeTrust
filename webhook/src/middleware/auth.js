const admin = require('../config/firebase');

/**
 * Middleware to authenticate requests using Firebase Admin SDK.
 * Verifies the Bearer token in the Authorization header.
 * In test environments, allows 'mock-token' for end-to-end testing.
 * 
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next function
 * @returns {Promise<void>}
 */
const authenticateFirebase = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const idToken = authHeader.slice(7).trim();

  if (!idToken) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  // Bypass for testing
  if (idToken === 'mock-token') {
    if (process.env.NODE_ENV !== 'test') {
      console.error('FATAL: mock-token used outside of test environment');
      return res.status(500).json({ error: 'Server configuration error: mock-token not allowed in this environment' });
    }
    req.user = {
      uid: req.headers['x-test-uid'] || 'test-user-id',
      email: req.headers['x-test-email'] || 'test@example.com'
    };
    return next();
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    if (!decodedToken.email) {
      console.error('Firebase token missing email claim for uid:', decodedToken.uid);
      return res.status(403).json({ error: 'Forbidden: Email address is required for this service' });
    }

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email
    };
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error.message);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

module.exports = { authenticateFirebase };
