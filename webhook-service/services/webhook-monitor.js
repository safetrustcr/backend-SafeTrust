const winston = require('winston');
const { Pool } = require('pg');
const webhookConfig = require('../config/webhook');
const nodemailer = require('nodemailer');

// Configure database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'webhook-monitor' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/webhook-monitor-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/webhook-monitor.log' })
  ],
});

// Configure email transport if enabled
let emailTransport = null;
if (process.env.ALERT_EMAIL_ENABLED === 'true') {
  emailTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
}

/**
 * Monitor webhook failures and trigger alerts when thresholds are exceeded
 */
class WebhookMonitor {
  constructor() {
    this.failureCounters = {};
    this.alertSent = {};
    this.alertThreshold = webhookConfig.alerts.consecutiveFailures;
    this.errorRateThreshold = webhookConfig.alerts.errorRateThreshold;
  }

  /**
   * Record a webhook failure
   * @param {string} transactionId - The escrow transaction ID
   * @param {string} eventId - The event ID
   * @param {number} statusCode - HTTP status code
   * @param {string} errorMessage - Error message
   */
  async recordFailure(transactionId, eventId, statusCode, errorMessage) {
    logger.warn('Webhook failure recorded', {
      transactionId,
      eventId,
      statusCode,
      error: errorMessage
    });

    // Increment failure counter for this transaction
    if (!this.failureCounters[transactionId]) {
      this.failureCounters[transactionId] = 0;
    }
    this.failureCounters[transactionId]++;

    // Update database with failure information
    try {
      await pool.query(
        `UPDATE escrow_transactions 
         SET webhook_status = 'failed', 
             webhook_attempts = COALESCE(webhook_attempts, 0) + 1,
             last_webhook_attempt = NOW(),
             http_status_code = $1,
             http_error_details = $2
         WHERE id = $3`,
        [statusCode, JSON.stringify({ error: errorMessage, eventId }), transactionId]
      );
    } catch (error) {
      logger.error('Failed to update transaction with webhook failure', {
        transactionId,
        error: error.message
      });
    }

    // Check if we need to trigger an alert
    if (this.failureCounters[transactionId] >= this.alertThreshold && !this.alertSent[transactionId]) {
      await this.triggerAlert(transactionId, this.failureCounters[transactionId], errorMessage);
      this.alertSent[transactionId] = true;
    }
  }

  /**
   * Record a webhook success
   * @param {string} transactionId - The escrow transaction ID
   * @param {string} eventId - The event ID
   */
  async recordSuccess(transactionId, eventId) {
    logger.info('Webhook success recorded', {
      transactionId,
      eventId
    });

    // Reset failure counter
    this.failureCounters[transactionId] = 0;
    this.alertSent[transactionId] = false;

    // Update database with success information
    try {
      await pool.query(
        `UPDATE escrow_transactions 
         SET webhook_status = 'success', 
             last_webhook_attempt = NOW()
         WHERE id = $1`,
        [transactionId]
      );
    } catch (error) {
      logger.error('Failed to update transaction with webhook success', {
        transactionId,
        error: error.message
      });
    }
  }

  /**
   * Trigger an alert for persistent webhook failures
   * @param {string} transactionId - The escrow transaction ID
   * @param {number} failureCount - Number of consecutive failures
   * @param {string} lastError - Last error message
   */
  async triggerAlert(transactionId, failureCount, lastError) {
    logger.error('Webhook failure threshold exceeded', {
      transactionId,
      failureCount,
      lastError
    });

    // Get transaction details
    let transaction;
    try {
      const result = await pool.query(
        'SELECT * FROM escrow_transactions WHERE id = $1',
        [transactionId]
      );
      transaction = result.rows[0];
    } catch (error) {
      logger.error('Failed to fetch transaction details for alert', {
        transactionId,
        error: error.message
      });
      return;
    }

    // Send email alert if configured
    if (emailTransport && process.env.ALERT_EMAIL_TO) {
      try {
        await emailTransport.sendMail({
          from: process.env.ALERT_EMAIL_FROM,
          to: process.env.ALERT_EMAIL_TO,
          subject: `[ALERT] Webhook Failure for Transaction ${transactionId}`,
          text: `
            Webhook failure threshold exceeded for escrow transaction.
            
            Transaction ID: ${transactionId}
            Transaction Type: ${transaction.transaction_type}
            Status: ${transaction.status}
            Consecutive Failures: ${failureCount}
            Last Error: ${lastError}
            
            Please investigate this issue as soon as possible.
          `,
          html: `
            <h2>Webhook Failure Alert</h2>
            <p>Webhook failure threshold exceeded for escrow transaction.</p>
            
            <ul>
              <li><strong>Transaction ID:</strong> ${transactionId}</li>
              <li><strong>Transaction Type:</strong> ${transaction.transaction_type}</li>
              <li><strong>Status:</strong> ${transaction.status}</li>
              <li><strong>Consecutive Failures:</strong> ${failureCount}</li>
              <li><strong>Last Error:</strong> ${lastError}</li>
            </ul>
            
            <p>Please investigate this issue as soon as possible.</p>
          `
        });
        
        logger.info('Alert email sent', {
          transactionId,
          recipient: process.env.ALERT_EMAIL_TO
        });
      } catch (error) {
        logger.error('Failed to send alert email', {
          transactionId,
          error: error.message
        });
      }
    }

    // Additional alert channels could be added here (Slack, SMS, etc.)
  }

  /**
   * Check for stalled webhooks that haven't been processed
   * This should be run periodically via a scheduled job
   */
  async checkStalledWebhooks() {
    try {
      // Find transactions with failed webhook status and last attempt older than retry window
      const result = await pool.query(`
        SELECT id, transaction_type, status, webhook_attempts, last_webhook_attempt
        FROM escrow_transactions
        WHERE webhook_status = 'failed'
        AND last_webhook_attempt < NOW() - INTERVAL '1 hour'
        AND webhook_attempts < $1
      `, [webhookConfig.retry.maxAttempts]);

      if (result.rows.length > 0) {
        logger.warn('Found stalled webhook transactions', {
          count: result.rows.length
        });

        // Trigger alerts for stalled transactions
        for (const tx of result.rows) {
          await this.triggerAlert(
            tx.id, 
            tx.webhook_attempts, 
            'Webhook processing stalled'
          );
        }
      }
    } catch (error) {
      logger.error('Error checking for stalled webhooks', {
        error: error.message
      });
    }
  }

  /**
   * Generate webhook health report
   * @returns {Object} Health report data
   */
  async generateHealthReport() {
    try {
      // Get webhook statistics
      const stats = await pool.query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN webhook_status = 'success' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN webhook_status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN webhook_status IS NULL THEN 1 ELSE 0 END) as pending,
          AVG(webhook_attempts) as avg_attempts
        FROM escrow_transactions
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `);

      // Get recent failures
      const failures = await pool.query(`
        SELECT id, transaction_type, status, webhook_attempts, last_webhook_attempt, http_error_details
        FROM escrow_transactions
        WHERE webhook_status = 'failed'
        AND last_webhook_attempt > NOW() - INTERVAL '24 hours'
        ORDER BY last_webhook_attempt DESC
        LIMIT 10
      `);

      return {
        timestamp: new Date().toISOString(),
        statistics: stats.rows[0],
        recentFailures: failures.rows,
        errorRate: stats.rows[0].total > 0 
          ? stats.rows[0].failed / stats.rows[0].total 
          : 0
      };
    } catch (error) {
      logger.error('Error generating webhook health report', {
        error: error.message
      });
      return {
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }
}

module.exports = new WebhookMonitor(); 