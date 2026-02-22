const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const Redis = require("ioredis");
const { logger } = require("../utils/logger");

// Create Redis client for rate limiting
let redis = null;
const redisUrl = process.env.REDIS_URL;
const redisHost = process.env.REDIS_HOST || "localhost";
const redisPort = parseInt(process.env.REDIS_PORT || "6379", 10);

try {
  if (redisUrl) {
    redis = new Redis(redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
    });
  } else {
    redis = new Redis({
      host: redisHost,
      port: redisPort,
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
  }

  redis.on("connect", () => {
    logger.info("Redis client connected for rate limiting");
  });

  redis.on("error", (err) => {
    logger.error("Redis connection error", { error: err.message });
  });
} catch (error) {
  logger.error("Failed to initialize Redis client", { error: error.message });
}

/**
 * Global rate limiter for all webhook endpoints
 */
const globalLimiter = rateLimit({
  store: redis
    ? new RedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix: "rl:global:",
    })
    : undefined,
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
    store: redis
      ? new RedisStore({
        sendCommand: (...args) => redis.call(...args),
        prefix: "rl:tenant:",
      })
      : undefined,
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
  store: redis
    ? new RedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix: "rl:critical:",
    })
    : undefined,
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
  createEndpointLimiter: createTenantLimiter,
  criticalLimiter,
  redis,
};
