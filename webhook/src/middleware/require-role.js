/**
 * Role-based Authorization Middleware
 * @param {string[]} allowedRoles - List of roles permitted to access the route
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    // Extract role from custom claims (assuming 'role' or 'admin' claim)
    const userRole = req.user.role || (req.user.admin ? 'admin' : null);

    if (!userRole || !allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions or role not assigned',
      });
    }

    next();
  };
}

module.exports = { requireRole };
