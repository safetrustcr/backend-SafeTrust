const { getAuth } = require('firebase-admin/auth');

/**
 * Verifies a Firebase Bearer token and attaches `uid`, `email`, `name`, `role`, and `admin` to `req.user`.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or malformed Authorization header',
    });
  }

  const token = authHeader.split('Bearer ')[1];

  // Bypass for testing
  if (token === 'mock-token') {
    if (process.env.NODE_ENV !== 'test') {
      console.error('FATAL: mock-token used outside of test environment');
      return res.status(500).json({ 
        error: 'Server configuration error',
        message: 'mock-token not allowed in this environment' 
      });
    }
    req.user = {
      uid: req.headers['x-test-uid'] || 'test-user-id',
      email: req.headers['x-test-email'] || 'test@example.com'
    };
    return next();
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
      admin: decoded.admin === true,
      name:  decoded.name,
      ...decoded, // Include all custom claims
    };
    next();
  } catch (error) {
    console.error('[auth] Token verification failed:', error.message);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }
}

module.exports = { authMiddleware };
