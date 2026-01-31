/**
 * Data Sanitization Utilities
 * Removes sensitive data before logging or storing
 */

const SENSITIVE_FIELDS = [
  "password",
  "newPassword",
  "oldPassword",
  "confirmPassword",
  "token",
  "secret",
  "apiKey",
  "api_key",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "privateKey",
  "private_key",
  "clientSecret",
  "client_secret",
  "authorization",
  "x-hasura-admin-secret",
  "cookie",
  "set-cookie",
  "signature",
];

/**
 * Sanitizes an object by redacting sensitive fields
 */
const sanitizeObject = (data, maxDepth = 5) => {
  if (maxDepth === 0) return "[Max depth reached]";
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeObject(item, maxDepth - 1));
  }

  if (typeof data === "object") {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (
        SENSITIVE_FIELDS.some((field) => lowerKey.includes(field.toLowerCase()))
      ) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = sanitizeObject(value, maxDepth - 1);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  return data;
};

/**
 * Sanitizes data for logging purposes
 */
const sanitizeForLog = (data) => {
  try {
    return sanitizeObject(data);
  } catch (error) {
    console.error("Error sanitizing data:", error);
    return "[Sanitization failed]";
  }
};

/**
 * Sanitize HTTP headers
 */
function sanitizeHeaders(headers) {
  return sanitizeObject(headers);
}

/**
 * Sanitize request body
 */
function sanitizeRequestBody(body) {
  return sanitizeObject(body);
}

/**
 * Sanitize response body
 */
function sanitizeResponseBody(body) {
  return sanitizeObject(body);
}

module.exports = {
  sanitizeObject,
  sanitizeForLog,
  sanitizeHeaders,
  sanitizeRequestBody,
  sanitizeResponseBody,
  truncateString: (str, maxLength = 1000) => {
    if (typeof str !== "string") return str;
    return str.length <= maxLength
      ? str
      : str.substring(0, maxLength) + "... [truncated]";
  },
  redactEmail: (email) => {
    if (!email || typeof email !== "string") return email;
    const [localPart, domain] = email.split("@");
    if (!domain) return email;
    return `${localPart.substring(0, 2)}***@${domain}`;
  },
};
