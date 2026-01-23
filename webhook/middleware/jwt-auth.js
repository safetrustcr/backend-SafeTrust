const jwt = require("jsonwebtoken");
const { logger } = require("../utils/logger");

/**
 * Middleware to validate JWT tokens from Hasura session variables
 * Extracts user identity and attaches to req.user
 */
function validateJWT(req, res, next) {
  try {
    const { session_variables } = req.body;

    // Session variables are optional for some webhooks
    if (!session_variables) {
      logger.debug("No session variables provided, skipping JWT validation");
      return next();
    }

    // Check for JWT token in session variables
    const token = session_variables["x-hasura-jwt"];

    if (token) {
      try {
        // Verify JWT token
        const decoded = jwt.verify(
          token,
          process.env.JWT_SECRET || process.env.HASURA_GRAPHQL_ADMIN_SECRET,
        );

        // Attach user info to request
        req.user = decoded;

        logger.info("JWT validated successfully", {
          user_id: decoded.sub,
          role: decoded["https://hasura.io/jwt/claims"]?.["x-hasura-role"],
        });
      } catch (jwtError) {
        // Log JWT validation failure but don't block request
        // (some webhooks might not have valid JWT)
        logger.warn("JWT validation failed", {
          error: jwtError.message,
          endpoint: req.path,
        });
      }
    }

    next();
  } catch (error) {
    logger.error("JWT validation middleware error", {
      error: error.message,
      endpoint: req.path,
    });

    // Don't block request on JWT validation errors
    // (JWT is optional for many webhook operations)
    next();
  }
}

module.exports = { validateJWT };
