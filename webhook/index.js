require('dotenv').config();
const { config } = require('./config');

console.log("Environment loaded for project:", config.FIREBASE_PROJECT_ID);
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

// Import security middleware
const { verifyAdminSecret } = require('./middleware/auth');
const { validateJWT } = require('./middleware/jwt-auth');
const { globalLimiter, createTenantLimiter, createEndpointLimiter } = require('./middleware/rate-limiter');
const { validateRequest } = require('./middleware/validator');
const ipWhitelist = require('./middleware/ip-whitelist');
const auditLog = require('./middleware/audit-logger');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const { logger } = require('./utils/logger');

// Import route handlers
const webhooksRoutes = require('./webhooks');
const forgotPasswordRoutes = require('./forgot-password');
const resetPasswordRoutes = require('./reset-password');
const prepareEscrowContractRoutes = require('./prepare-escrow-contract');

const app = express();

// Security headers
app.use(helmet());

// CORS configuration
app.use(cors({
  credentials: true,
  origin: true,
}));

// Request parsing
app.use(express.json());

// HTTP request logging
app.use(morgan('combined', { stream: logger.stream }));

// Disable x-powered-by header
app.disable('x-powered-by');

// IP whitelist (applies to all routes except /health)
app.use(ipWhitelist);

// Global rate limiting
app.use(globalLimiter);

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Debug middleware to log all requests (development only)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });
}

// Protected Routes - Require Hasura admin secret verification
// These routes are called by Hasura Actions/Events

// Prepare Escrow Contract - Protected endpoint for Hasura Actions
app.use('/',
  verifyAdminSecret,
  validateJWT,
  auditLog,
  createTenantLimiter(200),
  validateRequest('prepareEscrowContract'),
  prepareEscrowContractRoutes
);

// Hasura Webhooks - Protected endpoints
app.use('/',
  verifyAdminSecret,
  validateJWT,
  auditLog,
  createTenantLimiter(500),
  webhooksRoutes
);

// Public Routes - Password reset endpoints (no admin secret required)
// These are called directly by users, so they need stricter rate limiting

// Authentication routes - Public endpoints with rate limiting
app.use('/api/auth',
  auditLog,
  createEndpointLimiter(10), // Max 10 requests per minute
  forgotPasswordRoutes,
  resetPasswordRoutes
);

// 404 handler for undefined routes
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info(`🔐 Secure webhook service listening on port ${port}`);
  logger.info('Available routes:');
  logger.info('- GET  /health');
  logger.info('- GET  /api/auth/validate-reset-token (Public)');
  logger.info('- POST /api/auth/reset-password (Public)');
  logger.info('- POST /api/auth/forgot-password (Public)');
  logger.info('- POST /prepare-escrow-contract (Protected)');
  logger.info('- POST /webhooks/* (Protected)');
  logger.info('');
  logger.info('Security features enabled:');
  logger.info(`- IP Whitelist: ${process.env.IP_WHITELIST_ENABLED === 'true' ? 'Yes' : 'No'}`);
  logger.info(`- Audit Logging: ${process.env.AUDIT_LOGGING_ENABLED === 'true' ? 'Yes' : 'No'}`);
  logger.info(`- Rate Limiting: Yes (Redis: ${process.env.REDIS_URL ? 'Yes' : 'No (Memory)'})`);
});
