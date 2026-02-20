const { logger } = require('../utils/logger');
const escrowStateService = require('../services/escrow-state.service');
const notificationService = require('../services/notification.service');

/**
 * Handle refund requested event
 * Triggered when a refund is requested for an escrow
 */
async function handleRefundRequested(req, res) {
  const { event, table, trigger } = req.body;
  const { new: newData, old: oldData } = event.data;

  try {
    logger.info('Refund requested event received', {
      escrow_id: newData.id || newData.escrow_transaction_id,
      refund_status: newData.refund_status,
      previous_status: oldData?.refund_status,
    });

    const escrowId = newData.id || newData.escrow_transaction_id;

    // 1. Get escrow details
    const escrow = await escrowStateService.getEscrow(escrowId);
    if (!escrow) {
      logger.warn('Escrow not found', { escrow_id: escrowId });
      return res.status(404).json({
        success: false,
        message: 'Escrow not found',
      });
    }

    // 2. Get participants to notify
    const participants = await escrowStateService.getParticipants(escrowId);

    // 3. Send refund request notification to all participants
    const notificationPromises = participants.map(async (participant) => {
      try {
        await notificationService.send({
          to: participant.email,
          template: 'refund-requested',
          data: {
            participant_name: participant.display_name,
            escrow_id: escrow.id,
            contract_id: escrow.contract_id,
            refund_reason: newData.refund_reason || 'Not specified',
            requested_by: newData.requested_by_email || 'A participant',
          },
        });
      } catch (error) {
        logger.error('Failed to send notification', {
          error: error.message,
          participant: participant.email,
        });
      }
    });

    await Promise.allSettled(notificationPromises);

    logger.info('Refund requested event processed', {
      escrow_id: escrow.id,
      participants_notified: participants.length,
    });

    return res.json({
      success: true,
      message: 'Refund requested event processed',
      escrow_id: escrow.id,
      participants_notified: participants.length,
    });
  } catch (error) {
    logger.error('Refund requested event error:', {
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      message: 'Event processing failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}

module.exports = handleRefundRequested;
