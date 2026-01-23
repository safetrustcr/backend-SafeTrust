require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const { verifyAdminSecret } = require("./middleware/auth");
const { validateJWT } = require("./middleware/jwt-auth");
const {
  globalLimiter,
  createTenantLimiter,
} = require("./middleware/rate-limiter");
const { validateRequest } = require("./middleware/validator");
const ipWhitelist = require("./middleware/ip-whitelist");
const auditLog = require("./middleware/audit-logger");
const errorHandler = require("./middleware/error-handler");
const { logger } = require("./utils/logger");

// Route handlers
const webhooksRoutes = require("./webhooks");
const forgotPasswordRoutes = require("./forgot-password");
const resetPasswordRoutes = require("./reset-password");
const prepareEscrowContractRoutes = require("./prepare-escrow-contract");

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  }),
);

// CORS configuration
app.use(
  cors({
    credentials: true,
    origin: process.env.ALLOWED_ORIGINS?.split(",") || true,
  }),
);

// Body parser with size limit (prevent large payloads)
app.use(express.json({ limit: "1mb" }));

// HTTP request logging
app.use(morgan("combined", { stream: logger.stream }));

// Disable x-powered-by header
app.disable("x-powered-by");

// Apply IP whitelist globally
app.use(ipWhitelist);

// Apply global rate limiter
app.use(globalLimiter);

// Health check endpoint (no auth required)
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Apply authentication and audit logging to webhook routes
app.use("/webhooks", verifyAdminSecret, validateJWT, auditLog);

// Apply validation middleware to specific webhook endpoints
app.use(
  "/webhooks/escrow_status_update",
  createTenantLimiter(500),
  validateRequest("escrowStatusUpdate"),
);

app.use(
  "/webhooks/escrow_refund_status_update",
  createTenantLimiter(500),
  validateRequest("escrowRefundStatusUpdate"),
);

// Mount routes
app.use("/webhooks", webhooksRoutes);
app.use("/api/auth", forgotPasswordRoutes);
app.use("/api/auth", resetPasswordRoutes);
app.use(prepareEscrowContractRoutes);

// Global error handler (must be last)
app.use(errorHandler);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info(`🔐 Secure webhook service listening on port ${port}`);
  logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
  logger.info(
    `IP Whitelist: ${process.env.ALLOWED_IPS ? "Enabled" : "Disabled"}`,
  );
  logger.info("Available routes:");
  logger.info("- GET /health");
  logger.info("- GET /api/auth/validate-reset-token");
  logger.info("- POST /api/auth/reset-password");
  logger.info("- POST /api/auth/forgot-password");
  logger.info("- POST /webhooks/firebase/user-created");
  logger.info("- POST /webhooks/firebase/user-updated");
  logger.info("- POST /webhooks/firebase/user-deleted");
  logger.info("- POST /webhooks/escrow_status_update");
  logger.info("- POST /webhooks/escrow_refund_status_update");
  logger.info("- GET /webhooks/firebase/health");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM signal received: closing HTTP server");
  require("./middleware/rate-limiter").redis.quit();
  require("./utils/database").pool.end();
  process.exit(0);
});
