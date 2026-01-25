const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const { authMiddleware } = require('./middleware/auth');
const { errorHandler } = require('./middleware/error-handler');
const { logger } = require('./utils/logger');

// Import action handlers
const verifyWallet = require('./actions/verify-wallet');
const initiateFunding = require('./actions/initiate-funding');
const verifyTransaction = require('./actions/verify-transaction');
const releaseFunds = require('./actions/release-funds');
const processRefund = require('./actions/process-refund');

const app = express();
const PORT = process.env.WEBHOOK_PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));
app.use(express.json());
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Action endpoints (protected by Hasura admin secret)
app.post('/actions/verify-wallet', authMiddleware, verifyWallet);
app.post('/actions/initiate-funding', authMiddleware, initiateFunding);
app.post('/actions/verify-transaction', authMiddleware, verifyTransaction);
app.post('/actions/release-funds', authMiddleware, releaseFunds);
app.post('/actions/process-refund', authMiddleware, processRefund);

// Error handling
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`🚀 Webhook server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;