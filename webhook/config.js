/**
 * Configuration module for webhook service
 * Loads environment variables and exports configuration
 */

require('dotenv').config();

const config = {
  // Firebase Configuration
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || 'safetrust-dev',

  // Trustless Work API Driver
  TRUSTLESS_WORK_API_URL: process.env.TRUSTLESS_WORK_API_URL || 'https://api.trustlesswork.com',
  TRUSTLESS_WORK_API_KEY: process.env.TRUSTLESS_WORK_API_KEY,

  // Server Configuration
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Database Configuration
  DATABASE_URL: process.env.DATABASE_URL || process.env.PG_DATABASE_URL,

  // Hasura Configuration
  HASURA_ADMIN_SECRET: process.env.HASURA_ADMIN_SECRET,
  HASURA_GRAPHQL_ENDPOINT: process.env.HASURA_GRAPHQL_ENDPOINT,

  // JWT Configuration
  JWT_SECRET: process.env.JWT_SECRET,

  // Security Configuration
  IP_WHITELIST_ENABLED: process.env.IP_WHITELIST_ENABLED === 'true',
  IP_WHITELIST: process.env.IP_WHITELIST,
  AUDIT_LOGGING_ENABLED: process.env.AUDIT_LOGGING_ENABLED === 'true',

  // Rate Limiting
  REDIS_URL: process.env.REDIS_URL,
  GLOBAL_RATE_LIMIT: parseInt(process.env.GLOBAL_RATE_LIMIT || '1000', 10),

  // Email Configuration
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,

  // Frontend URL
  FRONTEND_URL: process.env.FRONTEND_URL,

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
  LOG_DIR: process.env.LOG_DIR,
};

module.exports = { config };
