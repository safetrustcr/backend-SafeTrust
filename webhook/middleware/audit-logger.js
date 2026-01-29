/**
 * Audit Logging Middleware
 * Logs all webhook requests to database for security auditing
 */

const { Pool } = require('pg');
const { sanitizeForLog } = require('../utils/sanitize');

// Initialize PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.PG_DATABASE_URL,
});

/**
 * Get client IP address
 */
const getClientIp = (req) => {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.ip
  );
};

/**
 * Audit logging middleware
 */
const auditLog = async (req, res, next) => {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Attach request ID to request object
  req.requestId = requestId;

  // Capture request details
  const auditData = {
    request_id: requestId,
    endpoint: req.path,
    method: req.method,
    ip_address: getClientIp(req),
    user_id: req.user?.userId || req.body?.session_variables?.['x-hasura-user-id'] || null,
    user_role: req.user?.role || req.body?.session_variables?.['x-hasura-role'] || 'anonymous',
    request_body: sanitizeForLog(req.body),
    headers: sanitizeForLog({
      'user-agent': req.headers['user-agent'],
      'content-type': req.headers['content-type'],
      'x-hasura-role': req.headers['x-hasura-role'],
    }),
  };

  // Capture response
  const originalSend = res.send;
  let responseBody = null;
  let statusCode = null;

  res.send = function (data) {
    responseBody = data;
    statusCode = res.statusCode;
    res.send = originalSend;
    return originalSend.call(this, data);
  };

  // Log completion
  const logCompletion = async () => {
    const duration = Date.now() - startTime;

    try {
      // Only log to database if audit logging is enabled
      if (process.env.AUDIT_LOGGING_ENABLED === 'true') {
        await pool.query(
          `INSERT INTO audit_logs
           (request_id, endpoint, method, ip_address, user_id, user_role,
            request_body, response_status, response_body, duration_ms, headers, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
          [
            auditData.request_id,
            auditData.endpoint,
            auditData.method,
            auditData.ip_address,
            auditData.user_id,
            auditData.user_role,
            JSON.stringify(auditData.request_body),
            statusCode,
            sanitizeForLog(responseBody ? JSON.stringify(responseBody).substring(0, 1000) : null),
            duration,
            JSON.stringify(auditData.headers),
          ]
        );
      }

      // Always log to console for debugging
      console.log('Audit Log:', {
        requestId: auditData.request_id,
        endpoint: auditData.endpoint,
        method: auditData.method,
        status: statusCode,
        duration: `${duration}ms`,
        userId: auditData.user_id,
        ip: auditData.ip_address,
      });
    } catch (error) {
      console.error('Failed to write audit log:', error);
      // Don't fail the request if audit logging fails
    }
  };

  // Log on response finish
  res.on('finish', logCompletion);
  res.on('close', logCompletion);

  next();
};

module.exports = auditLog;
