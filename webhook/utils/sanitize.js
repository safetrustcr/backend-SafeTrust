/**
 * Sanitize HTTP headers by removing sensitive authorization data
 * @param {Object} headers - Express request headers
 * @returns {Object} Sanitized headers
 */
function sanitizeHeaders(headers) {
  const sanitized = { ...headers };

  // Remove sensitive headers
  const sensitiveHeaders = [
    "x-hasura-admin-secret",
    "authorization",
    "cookie",
    "x-api-key",
  ];

  sensitiveHeaders.forEach((header) => {
    if (sanitized[header]) {
      sanitized[header] = "[REDACTED]";
    }
  });

  return sanitized;
}

/**
 * Sanitize request body by removing sensitive fields
 * @param {Object} body - Request body
 * @returns {Object} Sanitized body
 */
function sanitizeRequestBody(body) {
  if (!body || typeof body !== "object") {
    return body;
  }

  const sanitized = JSON.parse(JSON.stringify(body));

  // Redact sensitive fields in input
  if (sanitized.input) {
    if (sanitized.input.signature) {
      sanitized.input.signature = "[REDACTED]";
    }
    if (sanitized.input.private_key) {
      sanitized.input.private_key = "[REDACTED]";
    }
    if (sanitized.input.password) {
      sanitized.input.password = "[REDACTED]";
    }
  }

  // Redact session variables (may contain sensitive claims)
  if (sanitized.session_variables) {
    sanitized.session_variables = "[REDACTED]";
  }

  return sanitized;
}

/**
 * Sanitize response body by removing sensitive fields
 * @param {Object} body - Response body
 * @returns {Object} Sanitized body
 */
function sanitizeResponseBody(body) {
  if (!body || typeof body !== "object") {
    return body;
  }

  const sanitized = JSON.parse(JSON.stringify(body)); 
  // Redact sensitive response fields
  if (sanitized.transaction_hash) {
    sanitized.transaction_hash =
      sanitized.transaction_hash.substring(0, 10) + "...[REDACTED]";
  }

  if (sanitized.token) {
    sanitized.token = "[REDACTED]";
  }

  if (sanitized.private_key) {
    sanitized.private_key = "[REDACTED]";
  }

  return sanitized;
}

module.exports = {
  sanitizeHeaders,
  sanitizeRequestBody,
  sanitizeResponseBody,
};
