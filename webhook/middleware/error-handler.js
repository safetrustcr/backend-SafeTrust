const { logger } = require("../utils/logger");

/**
 * Global error handler middleware
 * Prevents information leakage through error messages
 * Must be registered as the LAST middleware in Express
 */
function errorHandler(err, req, res, next) {
  // Log detailed error internally (with stack trace)
  logger.error("Webhook error occurred", {
    error: err.message,
    stack: err.stack,
    endpoint: req.path,
    method: req.method,
    body: req.body,
    ip: req.ip,
    requestId: req.requestId,
  });

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  // Determine error message and code
  let message =
    statusCode === 500
      ? "Internal server error"
      : err.message || "Request failed";
  let errorCode =
    err.code || (statusCode === 500 ? "INTERNAL_ERROR" : "CLIENT_ERROR");

  // Handle specific error types for better client feedback
  if (err.name === "ValidationError") {
    message = "Validation error";
    errorCode = "VALIDATION_ERROR";
  } else if (
    err.name === "UnauthorizedError" ||
    err.name === "JsonWebTokenError"
  ) {
    message = "Authentication failed";
    errorCode = "AUTHENTICATION_ERROR";
  } else if (err.name === "ForbiddenError") {
    message = "Access forbidden";
    errorCode = "FORBIDDEN";
  } else if (statusCode === 429) {
    message = "Too many requests";
    errorCode = "RATE_LIMIT_EXCEEDED";
  }

  // Prepare response
  const response = {
    success: false,
    message: message,
    code: errorCode,
    requestId: req.requestId,
  };

  // In development, add error details for debugging
  if (process.env.NODE_ENV === "development") {
    response.error = err.message;
    response.stack = err.stack;
  }

  // Send error response
  res.status(statusCode).json(response);
}

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
