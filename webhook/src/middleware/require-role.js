/**
 * Role-based authorization factory. Expects `req.user.role` and/or `req.user.admin`
 * (set by `authenticateFirebase` or `authMiddleware` from Firebase token / custom claims).
 *
 * @param {string[]} allowedRoles Roles permitted for the route (e.g. `['admin']`).
 * @returns {import('express').RequestHandler}
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    const userRole = req.user.role || (req.user.admin ? 'admin' : 'guest');

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions',
      });
    }

    next();
  };
}

module.exports = { requireRole };
