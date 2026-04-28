const { getAuth } = require('firebase-admin/auth');

/**
 * Express middleware: verifies Firebase ID token (or test mock-token bypass).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
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

  // Bypass for integration tests (requires NODE_ENV=test)
  if (idToken === 'mock-token') {
    if (process.env.NODE_ENV !== 'test') {
      console.error('FATAL: mock-token used outside of test environment');
      return res.status(500).json({ error: 'Server configuration error: mock-token not allowed in this environment' });
    }
    req.user = {
      uid: req.headers['x-test-uid'] || 'test-user-id',
      email: req.headers['x-test-email'] || 'test@example.com',
      role: undefined,
      admin: false,
    };
    return next();
  }

  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    if (!decodedToken.email) {
      console.error('Firebase token missing email claim for uid:', decodedToken.uid);
      return res.status(403).json({ error: 'Forbidden: Email address is required for this service' });
    }

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: decodedToken.role,
      admin: decodedToken.admin === true,
    };
    return next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error.message);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

module.exports = { authenticateFirebase };
