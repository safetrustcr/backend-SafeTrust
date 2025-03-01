require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const webhookRoutes = require('./webhooks');
const { logger, errorLogger } = require('./config/logger');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(morgan('combined'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'webhook-service'
  });
});

// Mount webhook routes
app.use('/', webhookRoutes);

// Error handling middleware
app.use(errorLogger);

// Start the server
app.listen(PORT, () => {
  logger.info(`Webhook server started on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Webhook base URL: ${process.env.WEBHOOK_BASE_URL || 'http://localhost:' + PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

module.exports = app; 