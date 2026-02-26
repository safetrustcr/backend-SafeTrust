const { logger } = require('../../utils/logger');
const notificationService = require('../../services/notification.service');

/**
 * Handle escrow approval required event
 * Triggered when a new escrow_pending_approvals record is inserted
 *
 * Hasura event payload structure:
 * {
 *   event: {
 *     session_variables: {...},
 *     op: 'INSERT',
 *     data: {
 *       old: null,
 *       new: { ...pending approval data... }
 *     }
 *   },
 *   table: { name: 'escrow_pending_approvals', schema: 'public' },
 *   trigger: { name: 'on_escrow_approval_required' }
 * }
 */
async function handleApprovalRequired(req, res) {
  const { event, table, trigger } = req.body;
  const { new: newData } = event.data;

  try {
    logger.info('Escrow approval required event received', {
      approval_id: newData.id,
      escrow_id: newData.escrow_id,
      field_changed: newData.field_changed,
      customer_wallet_address: newData.customer_wallet_address,
      status: newData.status,
    });

    // Validate required fields
    if (!newData.customer_wallet_address) {
      logger.warn('Missing customer wallet address', { approval_id: newData.id });
      return res.status(400).json({
        success: false,
        message: 'Missing customer wallet address',
      });
    }

    // TODO: Send notification to customer via their preferred channel
    // This could be email, push notification, webhook, etc.
    // For now, we'll just log the event
    try {
      // Example notification structure (uncomment and customize when notification service is ready)
      // await notificationService.send({
      //   to: newData.customer_wallet_address,
      //   template: 'escrow-approval-required',
      //   data: {
      //     approval_id: newData.id,
      //     escrow_id: newData.escrow_id,
      //     field_changed: newData.field_changed,
      //     old_value: newData.old_value,
      //     new_value: newData.new_value,
      //     unsigned_xdr: newData.unsigned_xdr,
      //     expires_at: newData.expires_at,
      //   },
      // });

      logger.info('Customer should be notified of pending approval', {
        approval_id: newData.id,
        customer_wallet: newData.customer_wallet_address,
        field_changed: newData.field_changed,
      });
    } catch (notificationError) {
      logger.error('Failed to send approval notification', {
        error: notificationError.message,
        approval_id: newData.id,
      });
      // Don't fail the webhook just because notification failed
    }

    // Log the approval event
    logger.info('Escrow approval required event processed', {
      approval_id: newData.id,
      escrow_id: newData.escrow_id,
      field_changed: newData.field_changed,
      expires_at: newData.expires_at,
    });

    // Return success response
    return res.json({
      success: true,
      message: 'Approval required event processed',
      approval_id: newData.id,
      escrow_id: newData.escrow_id,
      field_changed: newData.field_changed,
    });
  } catch (error) {
    logger.error('Escrow approval required event error:', {
      error: error.message,
      stack: error.stack,
      approval_id: newData?.id,
    });

    return res.status(500).json({
      success: false,
      message: 'Event processing failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}

module.exports = handleApprovalRequired;
