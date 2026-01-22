/**
 * Simple logger utility for webhook event handlers
 * In production, consider using winston or similar
 */

const logLevel = process.env.LOG_LEVEL || 'info';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function shouldLog(level) {
  return levels[level] <= levels[logLevel];
}

const logger = {
  error: (message, meta = {}) => {
    if (shouldLog('error')) {
      console.error(`[ERROR] ${message}`, meta);
    }
  },
  warn: (message, meta = {}) => {
    if (shouldLog('warn')) {
      console.warn(`[WARN] ${message}`, meta);
    }
  },
  info: (message, meta = {}) => {
    if (shouldLog('info')) {
      console.log(`[INFO] ${message}`, meta);
    }
  },
  debug: (message, meta = {}) => {
    if (shouldLog('debug')) {
      console.log(`[DEBUG] ${message}`, meta);
    }
  },
};

module.exports = { logger };
