const { getAuth } = require('firebase-admin/auth');
const db = require('../services/db');

/**
 * Resolves the roles assigned to a user from the `public.user_roles` join table.
 *
 * Mirrors the query convention in `routes/auth/me.handler.js`: a user may hold
 * multiple roles, so `roles` is always an array. `role` is a convenience scalar
 * (the first assigned role, or `'guest'` when none are assigned) used by
 * `requireRole` and single-role response shapes.
 *
 * @param {string} uid Firebase UID / users.id.
 * @returns {Promise<{ roles: string[], role: string }>}
 */
async function resolveUserRole(uid) {
  const result = await db.query(
    `SELECT r.name
     FROM public.user_roles ur
     JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1`,
    [uid]
  );

  const roles = result.rows.map((row) => row.name);
  return { roles, role: roles[0] ?? 'guest' };
}

/**
 * Verifies a Firebase Bearer token and attaches `uid`, `email`, `name`, `role`,
 * `roles`, and `admin` to `req.user`. Roles are sourced from `public.user_roles`
 * (not Firebase custom claims) in both the test-bypass and verified-token paths.
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
    const uid = req.headers['x-test-uid'] || 'test-user-id';
    const { roles, role } = await resolveUserRole(uid);
    req.user = {
      uid,
      email: req.headers['x-test-email'] || 'test@example.com',
      roles,
      role,
    };
    return next();
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    const { roles, role } = await resolveUserRole(decoded.uid);
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      admin: decoded.admin === true,
      ...decoded, // Include all custom claims
      roles, // role/roles from user_roles win over any custom claims
      role,
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

module.exports = { authMiddleware, authenticateFirebase: authMiddleware, resolveUserRole };
