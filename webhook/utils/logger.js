const winston = require("winston");

// Determine log level from environment or default to 'info'
const logLevel = process.env.LOG_LEVEL || "info";

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  process.env.NODE_ENV === "production"
    ? winston.format.json() 
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...metadata }) => {
          let msg = `${timestamp} [${level}]: ${message}`;
          if (Object.keys(metadata).length > 0) {
            msg += ` ${JSON.stringify(metadata)}`;
          }
          return msg;
        }),
      ),
);

// Create Winston logger instance
const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  transports: [
    new winston.transports.Console(),
    // Add file transports for production
    ...(process.env.NODE_ENV === "production"
      ? [
          new winston.transports.File({
            filename: "logs/error.log",
            level: "error",
          }),
          new winston.transports.File({
            filename: "logs/combined.log",
          }),
        ]
      : []),
  ],
  // Don't exit on uncaught exceptions (let error handler manage it)
  exitOnError: false,
});

// Create a stream for Morgan HTTP logger integration
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

module.exports = { logger };
