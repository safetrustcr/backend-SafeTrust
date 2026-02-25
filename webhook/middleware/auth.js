const { logger } = require("../utils/logger");
const { sanitizeHeaders } = require("../utils/sanitize");

/**
 * Middleware to verify Hasura admin secret
 * Protects webhook endpoints from unauthorized access
 */
function verifyAdminSecret(req, res, next) {
  const adminSecret = req.headers["x-hasura-admin-secret"];
  // Support both variable names for compatibility
  const expectedSecret =
    process.env.HASURA_GRAPHQL_ADMIN_SECRET || process.env.HASURA_ADMIN_SECRET;

  if (!expectedSecret) {
    logger.error("Hasura admin secret is not configured in environment");
    return res.status(500).json({ error: "Server configuration error" });
  }

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

function verifyWebhookSecret(req, res, next) {
  const webhookSecret = req.headers["x-webhook-secret"];
  const expectedSecret = process.env.WEBHOOK_SECRET;

  if (!expectedSecret) {
    logger.error("Webhook secret is not configured in environment");
    return res.status(500).json({ error: "Server configuration error" });
  }

  if (!webhookSecret || webhookSecret !== expectedSecret) {
    logger.warn("Unauthorized escrow approval webhook access attempt", {
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

  next();
}

module.exports = { verifyAdminSecret, verifyWebhookSecret };
