const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const Redis = require("ioredis");
const { logger } = require("../utils/logger");

// Disable Redis for now - use memory store
const redis = null;

function makeRedisStore(prefix) {
  if (!redis) return undefined;
  return new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix,
  });
}

/**
 * Global rate limiter for all webhook endpoints
 */
const globalLimiter = rateLimit({
  store: makeRedisStore("rl:global:"),
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
    store: makeRedisStore("rl:tenant:"),
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
 * Create a per-endpoint rate limiter.
 * Each call site must provide a unique prefix to isolate its quota in Redis.
 */
function createEndpointLimiter(maxRequests = 100, windowMs = 15 * 60 * 1000, prefix = "rl:endpoint:") {
  return rateLimit({
    store: makeRedisStore(prefix),
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
  });
}

/**
 * Stricter limiter for sensitive operations
 */
const criticalLimiter = rateLimit({
  store: makeRedisStore("rl:critical:"),
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
  createEndpointLimiter,
  criticalLimiter,
  redis,
};
