/**
 * JWT Authentication Middleware
 * Validates JWT tokens from Hasura session variables
 */

const jwt = require('jsonwebtoken');

const validateJWT = (req, res, next) => {
  try {
    // Hasura sends session variables in the request body
    const sessionVariables = req.body?.session_variables;

    if (!sessionVariables) {
      return res.status(401).json({ error: 'Missing session variables' });
    }

    // Extract JWT from session variables (common patterns)
    const token = sessionVariables['x-hasura-jwt'] ||
                  sessionVariables['authorization']?.replace('Bearer ', '') ||
                  req.headers['authorization']?.replace('Bearer ', '');

    if (!token) {
      // If no JWT is required for certain routes, you can skip validation
      // For now, we'll attach session variables to request and continue
      req.user = {
        role: sessionVariables['x-hasura-role'] || 'anonymous',
        userId: sessionVariables['x-hasura-user-id'],
        sessionVariables
      };
      return next();
    }

    // Verify JWT if present
    const jwtSecret = process.env.JWT_SECRET || process.env.HASURA_GRAPHQL_JWT_SECRET;

    if (!jwtSecret) {
      console.error('JWT_SECRET is not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const decoded = jwt.verify(token, jwtSecret);

    // Attach user information to request
    req.user = {
      ...decoded,
      role: sessionVariables['x-hasura-role'] || decoded.role,
      userId: sessionVariables['x-hasura-user-id'] || decoded['https://hasura.io/jwt/claims']?.['x-hasura-user-id'],
      sessionVariables
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }

    console.error('JWT validation error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
};

module.exports = { validateJWT };
