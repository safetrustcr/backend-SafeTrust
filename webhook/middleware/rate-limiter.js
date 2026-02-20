const rateLimit = require("express-rate-limit");
const RedisStore = require("rate-limit-redis").default;
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
  logger.error("Failed to initialize Redis client", {
    error: error.message,
  });
}

/**
 * Helper to create Redis store correctly (v4 compatible)
 */
const createRedisStore = (prefix) => {
  if (!redis) return undefined;

  return new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix,
  });
};

/**
 * Global rate limiter
 */
const globalLimiter = rateLimit({
  store: createRedisStore("rl:global:"),
  windowMs: 15 * 60 * 1000,
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
    });
  },
});

/**
 * Per-tenant limiter
 */
function createTenantLimiter(maxRequests = 500) {
  return rateLimit({
    store: createRedisStore("rl:tenant:"),
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
 * Critical limiter
 */
const criticalLimiter = rateLimit({
  store: createRedisStore("rl:critical:"),
  windowMs: 60 * 1000,
  max: 10,
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