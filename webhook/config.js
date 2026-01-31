
require('dotenv').config();

module.exports = {
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
  },
  hasura: {
    endpoint: process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL || process.env.HASURA_GRAPHQL_ENDPOINT || 'http://localhost:8080/v1/graphql',
    adminSecret: process.env.HASURA_GRAPHQL_ADMIN_SECRET || 'myadminsecretkey',
  },
  database: {
    url: process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@localhost:5432/postgres',
  },
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
  },
  jwt: {
    secret: process.env.JWT_SECRET,
  },
  security: {
    ipWhitelistEnabled: process.env.IP_WHITELIST_ENABLED === 'true',
    ipWhitelist: process.env.IP_WHITELIST,
    auditLoggingEnabled: process.env.AUDIT_LOGGING_ENABLED === 'true',
  },
  rateLimiting: {
    redisUrl: process.env.REDIS_URL,
    globalRateLimit: parseInt(process.env.GLOBAL_RATE_LIMIT || '1000', 10),
     },
  email: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM,
  },
  frontend: {
    url: process.env.FRONTEND_URL,
  },
  logging: {
    level: process.env.LOG_LEVEL || 'debug',
    dir: process.env.LOG_DIR,
  },
};
