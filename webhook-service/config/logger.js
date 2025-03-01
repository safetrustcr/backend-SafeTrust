/**
 * Centralized logger configuration
 * This file provides a consistent logger instance for the entire application
 */

const winston = require('winston');
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'webhook-service' },
  transports: [
    // Use a more readable format for console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ level, message, timestamp, service, ...metadata }) => {
          // Filter out empty objects and the service field
          const filteredMetadata = Object.entries(metadata)
            .filter(([_, value]) => {
              // Keep only non-empty values
              if (typeof value === 'object' && value !== null) {
                return Object.keys(value).length > 0;
              }
              return value !== undefined && value !== null && value !== '';
            })
            .reduce((obj, [key, value]) => {
              obj[key] = value;
              return obj;
            }, {});
          
          // Only add metadata if there's something to show
          const metaStr = Object.keys(filteredMetadata).length > 0 
            ? `\n${JSON.stringify(filteredMetadata, null, 2)}` 
            : '';
            
          return `${timestamp} ${level}: ${message}${metaStr}`;
        })
      )
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ],
});

// Create a request logger middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // Log request
  logger.info('Request received', {
    method: req.method,
    path: req.path,
    headers: {
      'x-hasura-event-id': req.headers['x-hasura-event-id'],
      'content-type': req.headers['content-type'],
      'x-idempotency-key': req.headers['x-idempotency-key']
    }
  });
  
  // Capture response
  const originalSend = res.send;
  res.send = function(body) {
    res.responseBody = body;
    return originalSend.call(this, body);
  };
  
  // Log response after request is complete
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'error' : 'info';
    
    logger[level]('Response sent', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      eventId: req.headers['x-hasura-event-id'] || 'unknown'
    });
  });
  
  next();
};

// Error handling middleware
const errorLogger = (err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    eventId: req.headers['x-hasura-event-id'] || 'unknown'
  });
  
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
};

module.exports = {
  logger,
  requestLogger,
  errorLogger
}; 