const { logger } = require("../utils/logger");
const { query } = require("../utils/database");
const { sanitizeForLog } = require("../utils/sanitize");

/**
 * Get client IP address
 */
const getClientIp = (req) => {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.ip
  );
};

/**
 * Audit logging middleware
 * Logs all webhook requests to database for security auditing
 */
const auditLog = async (req, res, next) => {
  const startTime = Date.now();
  const requestId =
    req.headers["x-request-id"] ||
    `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Attach request ID to request object
  req.requestId = requestId;

  // Capture request details
  const auditData = {
    request_id: requestId,
    endpoint: req.path,
    method: req.method,
    ip_address: getClientIp(req),
    user_id:
      req.user?.userId ||
      req.body?.session_variables?.["x-hasura-user-id"] ||
      null,
    user_role:
      req.user?.role ||
      req.body?.session_variables?.["x-hasura-role"] ||
      "anonymous",
    request_body: sanitizeForLog(req.body),
    headers: sanitizeForLog({
      "user-agent": req.headers["user-agent"],
      "content-type": req.headers["content-type"],
      "x-hasura-role": req.headers["x-hasura-role"],
    }),
  };

  // Capture response
  const originalJson = res.json.bind(res);
  let responseBody = null;
  let statusCode = null;

  res.json = function (data) {
    responseBody = data;
    statusCode = res.statusCode;

    // Log completion asynchronously
    const duration = Date.now() - startTime;
    logAuditToDB(auditData, statusCode, responseBody, duration).catch((err) => {
      logger.error("Failed to write audit log in response wrapper", {
        error: err.message,
      });
    });

    return originalJson(data);
  };

  next();
};

/**
 * Persist audit log to database
 */
async function logAuditToDB(auditData, statusCode, responseBody, duration) {
  try {
    // Only log to database if audit logging is enabled (or default to true if env not set)
    if (process.env.AUDIT_LOGGING_ENABLED !== "false") {
      await query(
        `INSERT INTO webhook_audit_logs
         (request_id, endpoint, method, ip, user_id, tenant_id,
          request_body, status_code, response_body, duration_ms, user_agent, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
        [
          auditData.request_id,
          auditData.endpoint,
          auditData.method,
          auditData.ip_address,
          auditData.user_id,
          auditData.user_role, // Using role as tenant_id for now if specific tenant_id not available
          JSON.stringify(auditData.request_body),
          statusCode,
          JSON.stringify(sanitizeForLog(responseBody)),
          duration,
          auditData.headers["user-agent"],
        ],
      );
    }

    // Always log to structured logger for real-time monitoring
    logger.info("Webhook request audited", {
      requestId: auditData.request_id,
      endpoint: auditData.endpoint,
      method: auditData.method,
      status: statusCode,
      duration: `${duration}ms`,
      userId: auditData.user_id,
      ip: auditData.ip_address,
    });
  } catch (error) {
    logger.error("Failed to write audit log to database", {
      error: error.message,
      requestId: auditData.request_id,
    });
  }
}

module.exports = auditLog;
