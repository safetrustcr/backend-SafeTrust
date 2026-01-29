/**
 * Global Error Handler Middleware
 * Catches all errors and returns safe, consistent error responses
 */

const { logger } = require('../utils/logger');

/**
 * Global error handler
 * Should be the last middleware in the chain
 */
const errorHandler = (err, req, res, next) => {
  // Log the full error details internally
  logger.error('Error occurred:', {
    error: err.message,
    stack: err.stack,
    requestId: req.requestId,
    endpoint: req.path,
    method: req.method,
    userId: req.user?.userId,
    ip: req.ip,
  });

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  // Determine error message
  let message = 'Internal server error';
  let errorCode = 'INTERNAL_ERROR';

  // Handle specific error types
  if (err.name === 'ValidationError') {
    message = 'Validation error';
    errorCode = 'VALIDATION_ERROR';
  } else if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
    message = 'Authentication failed';
    errorCode = 'AUTHENTICATION_ERROR';
  } else if (err.name === 'ForbiddenError') {
    message = 'Access forbidden';
    errorCode = 'FORBIDDEN';
  } else if (statusCode === 404) {
    message = 'Resource not found';
    errorCode = 'NOT_FOUND';
  } else if (statusCode === 429) {
    message = 'Too many requests';
    errorCode = 'RATE_LIMIT_EXCEEDED';
  } else if (statusCode >= 400 && statusCode < 500) {
    // For 4xx errors, use the error message if available
    message = err.message || 'Bad request';
    errorCode = 'CLIENT_ERROR';
  }

  // In development, include more details
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const errorResponse = {
    error: message,
    code: errorCode,
    requestId: req.requestId,
    ...(isDevelopment && {
      details: err.message,
      stack: err.stack,
    }),
  };

  // Send error response
  res.status(statusCode).json(errorResponse);
};

/**
 * 404 handler for undefined routes
 */
const notFoundHandler = (req, res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.path}`);
  error.statusCode = 404;
  next(error);
};

/**
 * Async handler wrapper
 * Wraps async route handlers to catch errors
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
};
