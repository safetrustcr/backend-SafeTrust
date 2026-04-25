const { getAuth } = require('firebase-admin/auth');

/**
 * Firebase Authentication Middleware
 * Verifies the Bearer token in the Authorization header.
 * Attaches the decoded user to req.user.
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

  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = {
      uid:   decoded.uid,
      email: decoded.email,
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
