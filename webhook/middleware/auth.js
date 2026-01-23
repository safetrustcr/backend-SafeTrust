const { logger } = require("../utils/logger");
const { sanitizeHeaders } = require("../utils/sanitize");

/**
 * Middleware to verify Hasura admin secret
 * Protects webhook endpoints from unauthorized access
 */
function verifyAdminSecret(req, res, next) {
  const adminSecret = req.headers["x-hasura-admin-secret"];
  const expectedSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET;

  // Check if admin secret is provided and matches
  if (!adminSecret || adminSecret !== expectedSecret) {
    logger.warn("Unauthorized webhook access attempt", {
      ip: req.ip,
      endpoint: req.path,
      method: req.method,
      headers: sanitizeHeaders(req.headers),
    });

    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  // Admin secret verified, proceed to next middleware
  next();
}

module.exports = { verifyAdminSecret };
