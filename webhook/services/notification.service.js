const nodemailer = require('nodemailer');
const { logger } = require('../utils/logger');
require('dotenv').config();

/**
 * Notification service for sending emails, SMS, and push notifications
 * Currently implements email notifications via nodemailer
 */
class NotificationService {
  constructor() {
    // Initialize email transporter
    // Try to use existing email config or create new one
    this.transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER || process.env.SMTP_USER,
        pass: process.env.EMAIL_PASS || process.env.SMTP_PASS,
      },
    });

    // Email templates
    this.templates = {
      'escrow-created': {
        subject: 'Escrow Created - SafeTrust',
        html: (data) => `
          <h2>Hello ${data.participant_name || 'User'},</h2>
          <p>A new escrow has been created.</p>
          <p><strong>Escrow ID:</strong> ${data.escrow_id}</p>
          <p><strong>Contract ID:</strong> ${data.contract_id || 'N/A'}</p>
          <p><strong>Amount:</strong> ${data.amount || 'N/A'}</p>
          <p>You will receive updates as the escrow progresses.</p>
          <p>Best regards,<br>SafeTrust Team</p>
        `,
      },
      'funding-progress': {
        subject: 'Escrow Funding Progress Update',
        html: (data) => {
          const remaining = data.total_participants - data.funded_count;
          return `
            <h2>Hello ${data.participant_name || 'User'},</h2>
            <p><strong>${data.funded_by || 'A participant'}</strong> has funded the escrow.</p>
            <p><strong>Progress:</strong> ${data.funded_count}/${data.total_participants} (${data.percentage}%)</p>
            ${remaining > 0 
              ? `<p>Waiting for ${remaining} more participant(s) to fund.</p>` 
              : `<p>✅ All participants have funded! The escrow is now active.</p>`
            }
            <p><strong>Contract ID:</strong> ${data.contract_id || 'N/A'}</p>
            <p>Best regards,<br>SafeTrust Team</p>
          `;
        },
      },
      'escrow-activated': {
        subject: 'Escrow Now Active - All Parties Funded',
        html: (data) => `
          <h2>Hello ${data.participant_name || 'User'},</h2>
          <p>Great news! All participants have funded the escrow.</p>
          <p>The escrow is now <strong>ACTIVE</strong> and condition verification has begun.</p>
          <p><strong>Escrow ID:</strong> ${data.escrow_id}</p>
          <p><strong>Contract ID:</strong> ${data.contract_id || 'N/A'}</p>
          <p>Best regards,<br>SafeTrust Team</p>
        `,
      },
      'condition-verified': {
        subject: 'Escrow Condition Verified',
        html: (data) => `
          <h2>Hello ${data.participant_name || 'User'},</h2>
          <p>A condition has been verified for your escrow.</p>
          <p><strong>Condition:</strong> ${data.condition_description || 'N/A'}</p>
          <p><strong>Progress:</strong> ${data.verified_count}/${data.total_conditions} conditions verified</p>
          <p><strong>Escrow ID:</strong> ${data.escrow_id}</p>
          <p>Best regards,<br>SafeTrust Team</p>
        `,
      },
      'all-conditions-met': {
        subject: 'All Conditions Met - Funds Ready for Release',
        html: (data) => `
          <h2>Hello ${data.participant_name || 'User'},</h2>
          <p>All conditions have been met for your escrow!</p>
          <p>The funds are now ready to be released.</p>
          <p><strong>Escrow ID:</strong> ${data.escrow_id}</p>
          <p><strong>Contract ID:</strong> ${data.contract_id || 'N/A'}</p>
          <p>Best regards,<br>SafeTrust Team</p>
        `,
      },
      'fund-released': {
        subject: 'Escrow Completed - Funds Released',
        html: (data) => `
          <h2>Hello ${data.participant_name || 'User'},</h2>
          <p>🎉 Your escrow has been completed successfully!</p>
          <p>✅ <strong>Funds released:</strong> ${data.amount || 'N/A'}</p>
          ${data.transaction_hash ? `<p><strong>Transaction:</strong> ${data.transaction_hash}</p>` : ''}
          <p><strong>Escrow ID:</strong> ${data.escrow_id}</p>
          <p>Thank you for using SafeTrust!</p>
          <p>Best regards,<br>SafeTrust Team</p>
        `,
      },
      'refund-requested': {
        subject: 'Refund Request Received',
        html: (data) => `
          <h2>Hello ${data.participant_name || 'User'},</h2>
          <p>A refund request has been ${data.status || 'submitted'} for your escrow.</p>
          <p><strong>Escrow ID:</strong> ${data.escrow_id}</p>
          <p><strong>Status:</strong> ${data.refund_status || 'Pending review'}</p>
          <p>You will be notified once the refund is processed.</p>
          <p>Best regards,<br>SafeTrust Team</p>
        `,
      },
    };
  }

  /**
   * Send a notification
   * @param {Object} options - Notification options
   * @param {string} options.to - Recipient email address
   * @param {string} options.template - Template name
   * @param {Object} options.data - Template data
   * @returns {Promise<Object>} Send result
   */
  async send({ to, template, data = {} }) {
    try {
      const templateConfig = this.templates[template];
      if (!templateConfig) {
        throw new Error(`Template ${template} not found`);
      }

      // Skip email sending if no email config
      if (!process.env.EMAIL_USER && !process.env.SMTP_USER) {
        logger.warn('Email not configured, skipping notification', { to, template });
        return { success: true, skipped: true, reason: 'Email not configured' };
      }

      const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.SMTP_FROM || 'noreply@safetrust.com',
        to,
        subject: templateConfig.subject,
        html: templateConfig.html(data),
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Email sent: ${info.messageId}`, { to, template });

      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('Email send error:', { error: error.message, to, template });
      return { success: false, error: error.message };
    }
  }

  /**
   * Send SMS notification (stub for future implementation)
   * @param {Object} options - SMS options
   */
  async sendSMS({ to, message }) {
    logger.info('SMS notification (not implemented)', { to, message });
    // TODO: Implement SMS service integration
    return { success: false, error: 'SMS not implemented' };
  }

  /**
   * Send push notification (stub for future implementation)
   * @param {Object} options - Push notification options
   */
  async sendPush({ userId, title, body, data }) {
    logger.info('Push notification (not implemented)', { userId, title, body });
    // TODO: Implement push notification service
    return { success: false, error: 'Push notifications not implemented' };
  }
}

module.exports = new NotificationService();
