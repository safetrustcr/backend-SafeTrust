/**
 * Data Sanitization Utilities
 * Removes sensitive data before logging or storing
 */

// List of sensitive field names to redact
const SENSITIVE_FIELDS = [
  'password',
  'newPassword',
  'oldPassword',
  'confirmPassword',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'privateKey',
  'private_key',
  'clientSecret',
  'client_secret',
  'authorization',
  'x-hasura-admin-secret',
  'cookie',
  'set-cookie',
];

/**
 * Sanitizes an object by redacting sensitive fields
 * @param {*} data - Data to sanitize
 * @param {number} maxDepth - Maximum recursion depth
 * @returns {*} Sanitized data
 */
const sanitizeObject = (data, maxDepth = 5) => {
  if (maxDepth === 0) {
    return '[Max depth reached]';
  }

  if (data === null || data === undefined) {
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeObject(item, maxDepth - 1));
  }

  // Handle objects
  if (typeof data === 'object') {
    const sanitized = {};

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();

      // Check if field is sensitive
      if (SENSITIVE_FIELDS.some((field) => lowerKey.includes(field.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitizeObject(value, maxDepth - 1);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  // Return primitives as-is
  return data;
};

/**
 * Sanitizes data for logging purposes
 * @param {*} data - Data to sanitize
 * @returns {*} Sanitized data safe for logging
 */
const sanitizeForLog = (data) => {
  try {
    return sanitizeObject(data);
  } catch (error) {
    console.error('Error sanitizing data:', error);
    return '[Sanitization failed]';
  }
};

/**
 * Sanitizes a URL by removing sensitive query parameters
 * @param {string} url - URL to sanitize
 * @returns {string} Sanitized URL
 */
const sanitizeUrl = (url) => {
  try {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;

    // Redact sensitive query parameters
    SENSITIVE_FIELDS.forEach((field) => {
      if (params.has(field)) {
        params.set(field, '[REDACTED]');
      }
    });

    return urlObj.toString();
  } catch (error) {
    // If URL parsing fails, return as-is
    return url;
  }
};

/**
 * Redacts email addresses (keeps domain visible)
 * @param {string} email - Email to redact
 * @returns {string} Redacted email
 */
const redactEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return email;
  }

  const [localPart, domain] = email.split('@');
  if (!domain) {
    return email;
  }

  // Show first 2 characters of local part
  const visiblePart = localPart.substring(0, 2);
  return `${visiblePart}***@${domain}`;
};

/**
 * Truncates long strings to prevent log bloat
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
const truncateString = (str, maxLength = 1000) => {
  if (typeof str !== 'string') {
    return str;
  }

  if (str.length <= maxLength) {
    return str;
  }

  return str.substring(0, maxLength) + '... [truncated]';
};

module.exports = {
  sanitizeObject,
  sanitizeForLog,
  sanitizeUrl,
  redactEmail,
  truncateString,
};
