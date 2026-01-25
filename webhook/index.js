import { config } from "./config";

console.log("Environment loaded for project:", config.FIREBASE_PROJECT_ID);

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const webhooksRoutes = require('./webhooks');
const forgotPasswordRoutes = require('./forgot-password');
const resetPasswordRoutes = require('./reset-password');
const prepareEscrowContractRoutes = require('./prepare-escrow-contract');

// --- Web3 Action Imports ---
const verifyWallet = require('./actions/verify-wallet');
const initiateFunding = require('./actions/initiate-funding');
const verifyTransaction = require('./actions/verify-transaction');
const releaseFunds = require('./actions/release-funds');
const processRefund = require('./actions/process-refund');

// --- Middleware Imports ---
const { authMiddleware } = require('./middleware/auth'); 
const { logger } = require('./utils/logger');

const app = express();

const PORT = process.env.WEBHOOK_PORT || 3001;

// --- Middleware Setup ---
app.use(helmet()); // Added for security headers
app.use(express.json());
app.use(cors({
  credentials: true,
  origin: true,
}));
app.use(morgan('tiny'));
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

//Async Wrapper (Prevents crashes on async errors)
const asyncHandler = (fn) => (req, res, next) => 
  Promise.resolve(fn(req, res, next)).catch(next);

// --- Endpoints ---

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.use('/webhooks', webhooksRoutes);
app.use('/api/auth', forgotPasswordRoutes);
app.use('/api/auth', resetPasswordRoutes);
app.use(prepareEscrowContractRoutes);

// --- Hasura Action Routes ---
// Protected by authMiddleware and Rate Limiter
app.post('/actions/verify-wallet', authMiddleware, actionLimiter, asyncHandler(verifyWallet));
app.post('/actions/initiate-funding', authMiddleware, actionLimiter, asyncHandler(initiateFunding));
app.post('/actions/verify-transaction', authMiddleware, actionLimiter, asyncHandler(verifyTransaction));
app.post('/actions/release-funds', authMiddleware, actionLimiter, asyncHandler(releaseFunds));
app.post('/actions/process-refund', authMiddleware, actionLimiter, asyncHandler(processRefund));

// Error handler
app.use((err, req, res, next) => {
  if (err) {
    // Log to file/stream if it's an action error
    if (req.url.startsWith('/actions')) {
      logger.error(err.stack);
    } else {
      console.error(err.message);
      console.error(err.stack);
    }
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Webhook service listening on port ${PORT}`);
  console.log('Available routes:');
  console.log('- GET /health');
  console.log('- GET /api/auth/validate-reset-token');
  console.log('- POST /api/auth/reset-password');
  console.log('- POST /api/auth/forgot-password');
  console.log('- POST /webhooks/firebase/user-created');
  console.log('- POST /webhooks/firebase/user-updated');
  console.log('- POST /webhooks/firebase/user-deleted');
  console.log('- GET /webhooks/firebase/health');
  console.log('--- Hasura Actions ---');
  console.log('- POST /actions/verify-wallet');
  console.log('- POST /actions/initiate-funding');
  console.log('- POST /actions/verify-transaction');
  console.log('- POST /actions/release-funds');
  console.log('- POST /actions/process-refund');
});