/**
 * Webhook configuration settings
 * This file centralizes all webhook-related configuration
 */

module.exports = {
  // Retry configuration
  retry: {
    maxAttempts: parseInt(process.env.WEBHOOK_MAX_ATTEMPTS || '5'),
    initialDelay: parseInt(process.env.WEBHOOK_INITIAL_DELAY || '15000'), // 15 seconds
    maxDelay: parseInt(process.env.WEBHOOK_MAX_DELAY || '3600000'), // 1 hour
    backoffFactor: parseFloat(process.env.WEBHOOK_BACKOFF_FACTOR || '2.0'),
    jitter: parseFloat(process.env.WEBHOOK_JITTER || '0.1') // 10% jitter
  },
  
  // Timeout settings
  timeout: {
    request: parseInt(process.env.WEBHOOK_REQUEST_TIMEOUT || '30000'), // 30 seconds
    processing: parseInt(process.env.WEBHOOK_PROCESSING_TIMEOUT || '60000') // 60 seconds
  },
  
  // Authentication
  auth: {
    headerName: process.env.WEBHOOK_AUTH_HEADER || 'Authorization',
    secretEnvVar: 'WEBHOOK_SECRET'
  },
  
  // Alerting thresholds
  alerts: {
    consecutiveFailures: parseInt(process.env.WEBHOOK_ALERT_FAILURES || '3'),
    errorRateThreshold: parseFloat(process.env.WEBHOOK_ERROR_RATE_THRESHOLD || '0.1') // 10% error rate
  },
  
  // Logging
  logging: {
    level: process.env.WEBHOOK_LOG_LEVEL || 'info',
    includeHeaders: process.env.WEBHOOK_LOG_HEADERS === 'true',
    includeBody: process.env.WEBHOOK_LOG_BODY === 'true',
    sensitiveFields: [
      'password',
      'token',
      'secret',
      'authorization',
      'api_key'
    ]
  },
  
  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.WEBHOOK_RATE_LIMIT_WINDOW || '60000'), // 1 minute
    maxRequests: parseInt(process.env.WEBHOOK_RATE_LIMIT_MAX || '100') // 100 requests per minute
  },
  
  // Endpoints
  endpoints: {
    escrowTransaction: '/webhook/escrow-transaction',
    health: '/webhook/health'
  }
}; 