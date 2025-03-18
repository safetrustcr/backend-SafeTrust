const express = require('express');
const router = express.Router();
const escrowTransactionRouter = require('./escrow-transaction');
const { logger, requestLogger, errorLogger } = require('../config/logger');
const rateLimit = require('express-rate-limit');
const webhookConfig = require('../config/webhook');

// Apply request logging middleware
router.use(requestLogger);

// Rate limiting middleware
const webhookLimiter = rateLimit({
  windowMs: webhookConfig.rateLimit.windowMs,
  max: webhookConfig.rateLimit.maxRequests,
  message: 'Too many requests from this IP, please try again after a minute',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path
    });
    res.status(429).json({
      error: 'Too many requests, please try again later'
    });
  }
});

// Apply rate limiting to all webhook routes
router.use(webhookLimiter);

// Apply error handling middleware
router.use(errorLogger);

// Mount webhook routes
router.use('/webhook', escrowTransactionRouter);

// Health check endpoint
router.get('/webhook/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

module.exports = router; 