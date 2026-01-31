const jwt = require("jsonwebtoken");
const { logger } = require("../utils/logger");

/**
 * Middleware to validate JWT tokens from Hasura session variables
 * Extracts user identity and attaches to req.user
 */
function validateJWT(req, res, next) {
  try {
    const sessionVariables = req.body?.session_variables;

    // Session variables are optional for some webhooks
    if (!sessionVariables) {
      logger.debug("No session variables provided, skipping JWT validation");
      // Still set a default anonymous user if needed
      req.user = { role: "anonymous" };
      return next();
    }

    // Check for JWT token in session variables or headers
    const token =
      sessionVariables["x-hasura-jwt"] ||
      sessionVariables["authorization"]?.replace("Bearer ", "") ||
      req.headers["authorization"]?.replace("Bearer ", "");

    if (token) {
      try {
        // Verify JWT token
        const jwtSecret =
          process.env.JWT_SECRET ||
          process.env.HASURA_GRAPHQL_JWT_SECRET ||
          process.env.HASURA_GRAPHQL_ADMIN_SECRET;

        if (!jwtSecret) {
          logger.error("JWT secret is not configured");
          return res.status(500).json({ error: "Server configuration error" });
        }

        const decoded = jwt.verify(token, jwtSecret);

        // Attach user info to request, merging session variables and decoded token
        req.user = {
          ...decoded,
          userId:
            sessionVariables["x-hasura-user-id"] ||
            decoded.sub ||
            decoded["https://hasura.io/jwt/claims"]?.["x-hasura-user-id"],
          role:
            sessionVariables["x-hasura-role"] ||
            decoded["https://hasura.io/jwt/claims"]?.["x-hasura-role"] ||
            "user",
          sessionVariables,
        };

        logger.debug("JWT validated successfully", {
          user_id: req.user.userId,
          role: req.user.role,
        });
      } catch (jwtError) {
        logger.warn("JWT validation failed", {
          error: jwtError.message,
          endpoint: req.path,
        });
        // Attach anonymous role even if JWT fails, if we want to allow the request to proceed
        req.user = { role: "anonymous", error: jwtError.message };
      }
    } else {
      // No token, but have session variables
      req.user = {
        userId: sessionVariables["x-hasura-user-id"],
        role: sessionVariables["x-hasura-role"] || "anonymous",
        sessionVariables,
      };
    }

    next();
  } catch (error) {
    logger.error("JWT validation middleware error", {
      error: error.message,
      endpoint: req.path,
    });
    next();
  }
}

module.exports = { validateJWT };
