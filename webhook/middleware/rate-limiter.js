const rateLimit = require("express-rate-limit");
const RedisStore = require("rate-limit-redis");
const Redis = require("ioredis");
const { logger } = require("../utils/logger");

// Create Redis client for rate limiting
const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on("connect", () => {
  logger.info("Redis client connected for rate limiting");
});

redis.on("error", (err) => {
  logger.error("Redis connection error", { error: err.message });
});

/**
 * Global rate limiter for all webhook endpoints
 * Prevents DOS attacks across the entire service
 */
const globalLimiter = rateLimit({
  store: new RedisStore({
    // @ts-expect-error - Known issue with rate-limit-redis typings
    client: redis,
    prefix: "rl:global:",
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes
  message: "Too many requests, please try again later",
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
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
 * @param {number} maxRequests - Maximum requests per 15 minutes
 * @returns {Function} Express middleware
 */
function createTenantLimiter(maxRequests = 500) {
  return rateLimit({
    store: new RedisStore({
      // @ts-expect-error - Known issue with rate-limit-redis typings
      client: redis,
      prefix: "rl:tenant:",
    }),
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: maxRequests,
    keyGenerator: (req) => {
      // Use tenant ID from session variables, fallback to IP
      const { session_variables } = req.body;
      return session_variables?.["x-hasura-tenant-id"] || req.ip;
    },
    message: "Tenant rate limit exceeded",
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn("Tenant rate limit exceeded", {
        ip: req.ip,
        endpoint: req.path,
        tenant_id: req.body?.session_variables?.["x-hasura-tenant-id"],
      });

      res.status(429).json({
        success: false,
        message: "Tenant rate limit exceeded",
        retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
      });
    },
  });
}

/**
 * Critical endpoint limiter for sensitive operations
 * Very restrictive: only 10 requests per minute
 */
const criticalLimiter = rateLimit({
  store: new RedisStore({
    // @ts-expect-error - Known issue with rate-limit-redis typings
    client: redis,
    prefix: "rl:critical:",
  }),
  windowMs: 60 * 1000, 
  max: 10, 
  skipSuccessfulRequests: false,
  message: "Critical operation rate limit exceeded",
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.error("Critical endpoint rate limit exceeded", {
      ip: req.ip,
      endpoint: req.path,
      user_id: req.body?.session_variables?.["x-hasura-user-id"],
    });

    res.status(429).json({
      success: false,
      message: "Too many requests for this critical operation",
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
    });
  },
});

module.exports = {
  globalLimiter,
  createTenantLimiter,
  criticalLimiter,
  redis, 
};
