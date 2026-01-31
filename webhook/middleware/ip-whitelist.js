const { logger } = require("../utils/logger");

/**
 * Get client IP address from request
 * Handles proxies and load balancers
 */
const getClientIp = (req) => {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.ip
  );
};

// Parse allowed IPs from environment variable
const ALLOWED_IPS = (process.env.ALLOWED_IPS || process.env.IP_WHITELIST || "")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);
const WHITELIST_ENABLED =
  process.env.NODE_ENV === "production" ||
  process.env.IP_WHITELIST_ENABLED === "true";

/**
 * Middleware to enforce IP whitelist in production
 */
function ipWhitelist(req, res, next) {
  // Skip whitelist check in development mode if disabled
  if (!WHITELIST_ENABLED || ALLOWED_IPS.length === 0) {
    logger.debug("IP whitelist disabled or no IPs configured");
    return next();
  }

  // Skip for health checks
  if (req.path === "/health") {
    return next();
  }

  // Get client IP address
  const clientIP = getClientIp(req);

  // Check if IP is whitelisted
  const isWhitelisted = ALLOWED_IPS.includes(clientIP);

  if (!isWhitelisted) {
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
