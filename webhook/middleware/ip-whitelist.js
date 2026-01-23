const { logger } = require("../utils/logger");

// Parse allowed IPs from environment variable
const ALLOWED_IPS = (process.env.ALLOWED_IPS || "").split(",").filter(Boolean);
const WHITELIST_ENABLED = process.env.NODE_ENV === "production";

/**
 * Middleware to enforce IP whitelist in production
 * Only allows requests from pre-approved IP addresses
 */
function ipWhitelist(req, res, next) {
  // Skip whitelist check in development mode
  if (!WHITELIST_ENABLED || ALLOWED_IPS.length === 0) {
    logger.debug(
      "IP whitelist disabled (development mode or no IPs configured)",
    );
    return next();
  }

  // Get client IP address
  const clientIP = req.ip || req.connection.remoteAddress;

  // Check if IP is whitelisted
  if (!ALLOWED_IPS.includes(clientIP)) {
    logger.warn("IP whitelist violation", {
      ip: clientIP,
      endpoint: req.path,
      method: req.method,
    });

    return res.status(403).json({
      success: false,
      message: "Access denied",
    });
  }

  // IP is whitelisted, proceed
  logger.debug("IP whitelist passed", { ip: clientIP });
  next();
}

module.exports = ipWhitelist;
