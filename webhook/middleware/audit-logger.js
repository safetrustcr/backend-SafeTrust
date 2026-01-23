const { logger } = require("../utils/logger");
const { query } = require("../utils/database");
const {
  sanitizeRequestBody,
  sanitizeResponseBody,
} = require("../utils/sanitize");

/**
 * Middleware to audit log all webhook requests
 * Logs to database and Winston for compliance and monitoring
 */
function auditLog(req, res, next) {
  const startTime = Date.now();

  // Capture original response method
  const originalJson = res.json.bind(res);

  // Override res.json to capture response
  res.json = function (data) {
    const duration = Date.now() - startTime;

    // Log to database asynchronously (don't block response)
    logToDatabase({
      endpoint: req.path,
      method: req.method,
      ip: req.ip,
      user_id: req.body?.session_variables?.["x-hasura-user-id"] || null,
      tenant_id: req.body?.session_variables?.["x-hasura-tenant-id"] || null,
      status_code: res.statusCode,
      duration_ms: duration,
      success: res.statusCode < 400,
      request_body: sanitizeRequestBody(req.body),
      response_body: sanitizeResponseBody(data),
      user_agent: req.headers["user-agent"] || null,
      timestamp: new Date(),
    }).catch((err) => {
      logger.error("Failed to write audit log to database", {
        error: err.message,
      });
    });

    return originalJson(data);
  };

  next();
}

/**
 * Write audit log entry to database
 * @param {Object} logEntry - Log entry data
 */
async function logToDatabase(logEntry) {
  try {
    await query(
      `
      INSERT INTO webhook_audit_logs (
        endpoint, method, ip, user_id, tenant_id,
        status_code, duration_ms, success,
        request_body, response_body, user_agent, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
      [
        logEntry.endpoint,
        logEntry.method,
        logEntry.ip,
        logEntry.user_id,
        logEntry.tenant_id,
        logEntry.status_code,
        logEntry.duration_ms,
        logEntry.success,
        JSON.stringify(logEntry.request_body),
        JSON.stringify(logEntry.response_body),
        logEntry.user_agent,
        logEntry.timestamp,
      ],
    );

    // Also log to Winston for real-time monitoring
    logger.info("Webhook request completed", {
      endpoint: logEntry.endpoint,
      status: logEntry.status_code,
      duration: `${logEntry.duration_ms}ms`,
      success: logEntry.success,
      ip: logEntry.ip,
    });
  } catch (error) {
    // Log error but don't throw (audit logging shouldn't break requests)
    logger.error("Failed to insert audit log", {
      error: error.message,
      endpoint: logEntry.endpoint,
    });
  }
}

module.exports = auditLog;
