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

    // Assuming roles are stored in custom claims (decoded as req.user by firebase)
    // Map Firebase custom claims to a 'role' property if present, 
    // or check a specific claim like 'role' or 'admin'.
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
