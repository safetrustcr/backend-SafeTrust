const { logger } = require('../utils/logger');
const escrowStateService = require('../services/escrow-state.service');
const notificationService = require('../services/notification.service');

/**
 * Handle fund released event
 * Triggered when escrow_transactions.status changes to 'released' or 'RELEASED'
 */
async function handleFundReleased(req, res) {
  const { event, table, trigger } = req.body;
  const { new: newData, old: oldData } = event.data;

  try {
    logger.info('Fund released event received', {
      escrow_id: newData.id,
      status: newData.status,
      previous_status: oldData?.status,
    });

    const escrowId = newData.id;

    // 1. Get escrow details
    const escrow = await escrowStateService.getEscrow(escrowId);
    if (!escrow) {
      logger.warn('Escrow not found', { escrow_id: escrowId });
      return res.status(404).json({
        success: false,
        message: 'Escrow not found',
      });
    }

    // 2. Extract transaction hash from metadata if available
    const transactionHash = newData.metadata?.release_tx_hash || 
                           newData.release_tx_hash ||
                           null;

    // 3. Get participants to notify
    const participants = await escrowStateService.getParticipants(escrowId);

    // 4. Send completion notification to all participants
    const notificationPromises = participants.map(async (participant) => {
      try {
        await notificationService.send({
          to: participant.email,
          template: 'fund-released',
          data: {
            participant_name: participant.display_name,
            escrow_id: escrow.id,
            contract_id: escrow.contract_id,
            amount: escrow.amount,
            transaction_hash: transactionHash,
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

    // 5. Log finalization
    logger.info('Fund released event processed', {
      escrow_id: escrow.id,
      transaction_hash: transactionHash,
      participants_notified: participants.length,
    });

    return res.json({
      success: true,
      message: 'Fund released event processed',
      escrow_id: escrow.id,
      transaction_hash: transactionHash,
      participants_notified: participants.length,
    });
  } catch (error) {
    logger.error('Fund released event error:', {
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

module.exports = handleFundReleased;
