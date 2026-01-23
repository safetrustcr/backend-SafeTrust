/**
 * Rate Limiting Middleware
 * Implements global and tenant-specific rate limiting
 */

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');

// Initialize Redis client if Redis URL is configured
let redisClient = null;
if (process.env.REDIS_URL) {
  try {
    redisClient = new Redis(process.env.REDIS_URL, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
    });

    redisClient.on('error', (err) => {
      console.error('Redis client error:', err);
    });

    redisClient.on('connect', () => {
      console.log('Redis connected for rate limiting');
    });
  } catch (error) {
    console.error('Failed to initialize Redis:', error);
  }
}

// Global rate limiter - applies to all requests
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.GLOBAL_RATE_LIMIT || 1000, // Limit each IP to 1000 requests per windowMs
  message: { error: 'Too many requests from this IP, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  // Use Redis store if available, otherwise use memory store
  ...(redisClient && {
    store: new RedisStore({
      client: redisClient,
      prefix: 'rl:global:',
    }),
  }),
});

// Tenant-specific rate limiter factory
const createTenantLimiter = (maxRequests = 500) => {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: maxRequests,
    message: { error: 'Too many requests for this account, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    // Use Redis store if available
    ...(redisClient && {
      store: new RedisStore({
        client: redisClient,
        prefix: 'rl:tenant:',
      }),
    }),
    // Key generator based on tenant/user ID
    keyGenerator: (req) => {
      // Try to get tenant/user ID from various sources
      const userId = req.user?.userId ||
                     req.body?.session_variables?.['x-hasura-user-id'] ||
                     req.body?.input?.user_id ||
                     req.ip;
      return `tenant:${userId}`;
    },
    // Skip rate limiting for certain conditions
    skip: (req) => {
      // Skip for health checks
      return req.path === '/health';
    },
  });
};

// Endpoint-specific rate limiter (stricter for sensitive operations)
const createEndpointLimiter = (maxRequests = 10) => {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: maxRequests,
    message: { error: 'Too many attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    ...(redisClient && {
      store: new RedisStore({
        client: redisClient,
        prefix: 'rl:endpoint:',
      }),
    }),
    keyGenerator: (req) => {
      const userId = req.user?.userId || req.ip;
      return `${req.path}:${userId}`;
    },
  });
};

module.exports = {
  globalLimiter,
  createTenantLimiter,
  createEndpointLimiter,
  redisClient,
};
