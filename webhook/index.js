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
const rateLimit = require('express-rate-limit');
const webhooksRoutes = require('./webhooks');
const forgotPasswordRoutes = require('./forgot-password');
const resetPasswordRoutes = require('./reset-password');
const prepareEscrowContractRoutes = require('./prepare-escrow-contract');
const propertiesRoutes = require('./routes/properties');

// Event trigger handlers
const escrowCreatedHandler = require('./events/escrow-created');
const userFundedHandler = require('./events/user-funded');
const allFundedHandler = require('./events/all-funded');
const conditionVerifiedHandler = require('./events/condition-verified');
const allConditionsMetHandler = require('./events/all-conditions-met');
const fundReleasedHandler = require('./events/fund-released');
const refundRequestedHandler = require('./events/refund-requested');

// --- Web3 Action Imports ---
const verifyWallet = require('./actions/verify-wallet');
const initiateFunding = require('./actions/initiate-funding');
const verifyTransaction = require('./actions/verify-transaction');
const releaseFunds = require('./actions/release-funds');
const processRefund = require('./actions/process-refund');
const openDispute = require('./actions/open-dispute');


// --- Middleware Imports ---
const { authMiddleware } = require('./middleware/auth');

const app = express();

const PORT = process.env.WEBHOOK_PORT || 3001;

// --- Middleware Setup ---
app.use(helmet());
app.use(express.json());
app.use(cors({
  credentials: true,
  origin: true,
}));

// HTTP request logging
app.use(morgan('combined', { stream: logger.stream }));

// Disable x-powered-by header
app.disable('x-powered-by');

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.originalUrl.startsWith('/actions')) {
      const duration = Date.now() - start;
      logger.info(`[${req.method}] ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

const actionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

//Async Wrapper
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);


// IP whitelist
app.use(ipWhitelist);

// Global rate limiting
app.use(globalLimiter);

// --- Endpoints ---

// Public property details endpoint
app.use('/api/properties', propertiesRoutes);
// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Protected Routes
app.use('/',
  verifyAdminSecret,
  validateJWT,
  auditLog,
  createTenantLimiter(200),
  validateRequest('prepareEscrowContract'),
  prepareEscrowContractRoutes
);

app.post('/api/escrow/dispute',
  verifyAdminSecret,
  validateJWT,
  auditLog,
  createTenantLimiter(300),
  openDispute
);

// Hasura Webhooks
app.use('/',
  verifyAdminSecret,
  validateJWT,
  auditLog,
  createTenantLimiter(500),
  webhooksRoutes
);

// Error handler
app.use(errorHandler);
app.use(notFoundHandler);

app.listen(PORT, () => {
  logger.info(`🔐 Secure webhook service listening on port ${PORT}`);
  logger.info('Available routes:');
  logger.info('- GET  /health');
  logger.info('- GET  /api/properties/:id (Public)');
  logger.info('- GET  /api/auth/validate-reset-token (Public)');
  logger.info('- POST /api/auth/reset-password (Public)');
  logger.info('- POST /api/auth/forgot-password (Public)');
  logger.info('- POST /api/escrow/dispute (Protected)');
  logger.info('- POST /prepare-escrow-contract (Protected)');
  logger.info('- POST /webhooks/* (Protected)');
  logger.info('');
  logger.info('Security features enabled:');
  logger.info(`- IP Whitelist: ${process.env.IP_WHITELIST_ENABLED === 'true' ? 'Yes' : 'No'}`);
  logger.info(`- Audit Logging: ${process.env.AUDIT_LOGGING_ENABLED === 'true' ? 'Yes' : 'No'}`);
  logger.info(`- Rate Limiting: Yes (Redis: ${process.env.REDIS_URL ? 'Yes' : 'No (Memory)'})`);
  console.log('--- Hasura Actions ---');
  console.log('- POST /actions/verify-wallet');
  console.log('- POST /actions/initiate-funding');
  console.log('- POST /actions/verify-transaction');
  console.log('- POST /actions/release-funds');
  console.log('- POST /actions/process-refund');
  console.log('- POST /api/escrow/dispute');
});