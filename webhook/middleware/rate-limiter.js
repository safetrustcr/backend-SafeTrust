const rateLimit = require("express-rate-limit");
const { logger } = require("../utils/logger");

// Disable Redis for now - use memory store
const redis = null;

/**
 * Global rate limiter for all webhook endpoints
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.GLOBAL_RATE_LIMIT || "1000", 10),
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn("Global rate limit exceeded", {
      ip: req.ip,
      endpoint: req.path,
    });

    res.status(429).json({
      success: false,
      message: "Rate limit exceeded",
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
    });
  },
});

/**
 * Create a per-tenant rate limiter
 */
function createTenantLimiter(maxRequests = 500) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: maxRequests,
    keyGenerator: (req) => {
      return (
        req.user?.userId ||
        req.body?.session_variables?.["x-hasura-user-id"] ||
        req.ip
      );
    },
    message: { error: "Tenant rate limit exceeded" },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === "/health",
  });
}

/**
 * Stricter limiter for sensitive operations
 */
const criticalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  skipSuccessfulRequests: false,
  message: { error: "Critical operation rate limit exceeded" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return `${req.path}:${req.user?.userId || req.ip}`;
  },
});

module.exports = {
  globalLimiter,
  createTenantLimiter,
  criticalLimiter,
  redis,
};
