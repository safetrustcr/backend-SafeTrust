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
  });

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  // Prepare response (generic message for security)
  const response = {
    success: false,
    message:
      statusCode === 500
        ? "Internal server error"
        : err.message || "Request failed",
  };

  // In development, add error details for debugging
  if (process.env.NODE_ENV === "development") {
    response.error = err.message;
    response.stack = err.stack;
  }

  // Send error response
  res.status(statusCode).json(response);
}

module.exports = errorHandler;
